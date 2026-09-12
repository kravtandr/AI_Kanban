import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import type { Project } from "../types";
import Modal from "./Modal";

export default function ProjectManager({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const projects = useQuery({ queryKey: ["projects", "all"], queryFn: api.allProjects });
  const [editing, setEditing] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#6b7280");
  const mutation = useMutation({
    mutationFn: (operation: () => Promise<unknown>) => operation(),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["projects"] });
      client.invalidateQueries({ queryKey: ["tasks"] });
      client.invalidateQueries({ queryKey: ["task"] });
      client.invalidateQueries({ queryKey: ["analytics"] });
    },
  });
  function edit(project: Project) {
    setEditing(project.id); setName(project.name); setDescription(project.description); setColor(project.color);
  }
  async function save() {
    if (!name.trim() || mutation.isPending) return;
    try {
      await mutation.mutateAsync(() => editing === null
        ? api.createProject({ name: name.trim(), description, color })
        : api.patchProject(editing, { name: name.trim(), description, color }));
      setEditing(null); setName(""); setDescription("");
    } catch { /* Mutation error is displayed below. */ }
  }
  return <Modal title="Проекты" onClose={onClose} onSubmit={save}>
    {projects.isError && <p role="alert">Не удалось загрузить проекты</p>}
    {mutation.isError && <p role="alert" className="text-danger">{mutation.error.message}</p>}
    <div className="mb-5 space-y-3">
      {projects.data?.map((project) => <div key={project.id} className="border-b border-edge pb-2">
        <p>{project.name}{project.archived_at ? " · архив" : ""}</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" onClick={() => edit(project)}>Изменить {project.name}</button>
          {!project.is_inbox && <>
            <button className="btn-ghost" disabled={mutation.isPending} onClick={() => mutation.mutate(() => api.patchProject(project.id, { archived: !project.archived_at }))}>
              {project.archived_at ? "Восстановить" : "Архивировать"} {project.name}
            </button>
            <button className="btn-ghost text-danger" disabled={mutation.isPending} onClick={() => {
              if (window.confirm(`Удалить проект «${project.name}» и все его задачи без возможности восстановления?`)) {
                mutation.mutate(() => api.deleteProject(project.id));
              }
            }}>Удалить {project.name}</button>
          </>}
        </div>
      </div>)}
    </div>
    <p className="mb-2">{editing === null ? "Новый проект" : "Редактирование проекта"}</p>
    <label className="mb-2 block">Название проекта<input className="input" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></label>
    <label className="mb-2 block">Описание проекта<textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
    <label className="mb-3 block">Цвет проекта<input type="color" className="ml-3" value={color} onChange={(e) => setColor(e.target.value)} /></label>
    <div className="flex flex-wrap gap-2">
      <button className="btn-primary" disabled={!name.trim() || mutation.isPending} onClick={save}>{editing === null ? "Создать проект" : "Сохранить проект"}</button>
      {editing !== null && <button className="btn-ghost" onClick={() => { setEditing(null); setName(""); setDescription(""); }}>Отменить редактирование</button>}
      <button className="btn-ghost" onClick={onClose}>Закрыть</button>
    </div>
  </Modal>;
}
