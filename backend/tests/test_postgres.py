"""Optional real-database checks; TEST_DATABASE_URL must point at a test server.

Each test creates and drops its own UUID-named schema. No public tables or
existing schema contents are modified.
"""

import os
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker

from app.models import Base, Task, TaskStatus
from app.services import projects, tasks


@pytest.fixture()
def postgres_sessions():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL is not configured")
    schema = f"test_tasktracker_{uuid4().hex}"
    admin = create_engine(url)
    engine = None
    try:
        with admin.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        engine = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
        Base.metadata.create_all(engine)
        factory = sessionmaker(bind=engine, expire_on_commit=False)
        with factory() as db:
            projects.get_inbox(db)
        yield factory
    finally:
        if engine is not None:
            engine.dispose()
        with admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        admin.dispose()


def test_postgres_project_task_lifecycle(postgres_sessions):
    with postgres_sessions() as db:
        project = projects.create_project(db, "Сварог")
        renamed = projects.update_project(db, project.id, name="сварог")
        assert renamed.name == "сварог"
        assert projects.find_project_by_name(db, "СВАРОГ").id == project.id
        first = tasks.create_task(db, title="First", project_id=project.id, tags=["тест"])
        second = tasks.create_task(db, title="Second", project_id=project.id)
        tasks.move_task(db, second.id, TaskStatus.todo, sort_order=1)
        ordered = tasks.list_tasks(db)
        assert [task.id for task in ordered] == [second.id, first.id]
        assert [task.sort_order for task in ordered] == [1, 2]
        assert tasks.list_tasks(db, query="ТЕСТ")[0].id == first.id
        tasks.move_task(db, first.id, TaskStatus.done)
        assert first.completed_at is not None
        summary = tasks.daily_summary(db, first.completed_at.date())
        assert [row["id"] for row in summary["completed"]] == [first.id]
        tasks.update_task(db, second.id, due_date=date(2030, 1, 1))
        assert tasks.daily_summary(db, date(2030, 1, 2))["overdue"][0]["id"] == second.id
        tasks.delete_task(db, second.id)
        assert [task.id for task in tasks.list_tasks(db)] == [first.id]
        projects.update_project(db, project.id, archived=True)
        assert tasks.list_tasks(db) == []
        projects.delete_project(db, project.id, force=True)
        assert db.scalar(select(Task.id)) is None


def test_postgres_concurrent_reorders(postgres_sessions):
    with postgres_sessions() as db:
        ids = [tasks.create_task(db, title=str(index)).id for index in range(5)]
    barrier = Barrier(2)

    def reorder(task_id):
        with postgres_sessions() as db:
            # Both sessions cache their task before the other transaction writes.
            tasks.get_task(db, task_id)
            barrier.wait(timeout=10)
            tasks.move_task(db, task_id, TaskStatus.todo, sort_order=1)

    with ThreadPoolExecutor(max_workers=2) as executor:
        list(executor.map(reorder, [ids[3], ids[4]]))
    with postgres_sessions() as db:
        ordered = tasks.list_tasks(db)
        assert sorted(task.id for task in ordered) == ids
        assert [task.sort_order for task in ordered] == [1, 2, 3, 4, 5]


def test_postgres_concurrent_opposite_column_moves(postgres_sessions):
    with postgres_sessions() as db:
        first = tasks.create_task(db, title="First").id
        second = tasks.create_task(db, title="Second", status=TaskStatus.backlog).id
    barrier = Barrier(2)

    def move(item):
        task_id, status = item
        with postgres_sessions() as db:
            tasks.get_task(db, task_id)
            barrier.wait(timeout=10)
            tasks.move_task(db, task_id, status, sort_order=1)

    with ThreadPoolExecutor(max_workers=2) as executor:
        list(executor.map(move, [(first, TaskStatus.backlog), (second, TaskStatus.todo)]))
    with postgres_sessions() as db:
        assert tasks.get_task(db, first).status == TaskStatus.backlog
        assert tasks.get_task(db, second).status == TaskStatus.todo
