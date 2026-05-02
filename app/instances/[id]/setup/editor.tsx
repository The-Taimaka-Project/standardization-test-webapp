'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  addGroupAction,
  bulkSetEnumeratorsAction,
  listEnumeratorsAction,
} from '@/lib/actions/instances';

interface EnumRow {
  id?: string;
  enumeratorId: number;
  displayName: string | null;
  measuresMuac: boolean;
  measuresWeight: boolean;
  measuresHeight: boolean;
}

export function SetupEditor({
  instanceId,
  groups: initialGroups,
  supervisorEnumeratorId,
}: {
  instanceId: string;
  groups: { id: string; groupNumber: number; label: string | null }[];
  supervisorEnumeratorId: number;
}) {
  const [groups, setGroups] = useState(initialGroups);
  const [activeGroupId, setActiveGroupId] = useState(initialGroups[0]?.id ?? null);
  const [rows, setRows] = useState<EnumRow[]>([]);
  const [pending, startTransition] = useTransition();
  const [savedNote, setSavedNote] = useState<string | null>(null);

  useEffect(() => {
    if (!activeGroupId) return;
    let cancelled = false;
    listEnumeratorsAction(activeGroupId).then((r) => {
      if (cancelled) return;
      if (r.length === 0) {
        // Pre-fill: supervisor + 5 trainees as a starting roster the user can edit.
        const seed: EnumRow[] = [
          { enumeratorId: supervisorEnumeratorId, displayName: 'Supervisor', measuresMuac: true, measuresWeight: true, measuresHeight: true },
        ];
        for (let i = 1; i <= 10; i++) {
          seed.push({ enumeratorId: i, displayName: '', measuresMuac: true, measuresWeight: true, measuresHeight: true });
        }
        setRows(seed);
      } else {
        setRows(r.map((e) => ({
          id: e.id,
          enumeratorId: e.enumeratorId,
          displayName: e.displayName,
          measuresMuac: e.measuresMuac,
          measuresWeight: e.measuresWeight,
          measuresHeight: e.measuresHeight,
        })));
      }
    });
    return () => { cancelled = true; };
  }, [activeGroupId, supervisorEnumeratorId]);

  function addRow() {
    const maxId = rows.reduce((m, r) => Math.max(m, r.enumeratorId), 0);
    setRows([...rows, { enumeratorId: maxId + 1, displayName: '', measuresMuac: true, measuresWeight: true, measuresHeight: true }]);
  }

  function update(idx: number, patch: Partial<EnumRow>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function remove(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  function save() {
    if (!activeGroupId) return;
    startTransition(async () => {
      await bulkSetEnumeratorsAction(activeGroupId, rows.map((r) => ({
        enumeratorId: r.enumeratorId,
        displayName: r.displayName,
        measuresMuac: r.measuresMuac,
        measuresWeight: r.measuresWeight,
        measuresHeight: r.measuresHeight,
      })));
      setSavedNote('Saved.');
      setTimeout(() => setSavedNote(null), 1500);
    });
  }

  async function newGroup() {
    const g = await addGroupAction(instanceId);
    setGroups([...groups, { id: g.id, groupNumber: g.groupNumber, label: g.label }]);
    setActiveGroupId(g.id);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {groups.map((g) => (
          <button
            key={g.id}
            onClick={() => setActiveGroupId(g.id)}
            className={`btn ${g.id === activeGroupId ? 'btn-primary' : ''}`}
          >
            {g.label ?? `Group ${g.groupNumber}`}
          </button>
        ))}
        <button className="btn" onClick={newGroup}>+ Add group</button>
      </div>

      <div className="panel p-4">
        <table className="std">
          <thead>
            <tr>
              <th>Enumerator ID</th>
              <th>Display name</th>
              <th>MUAC</th>
              <th>Weight</th>
              <th>Height</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={idx}>
                <td>
                  <input className="input w-24" type="number" value={r.enumeratorId} onChange={(e) => update(idx, { enumeratorId: parseInt(e.target.value || '0', 10) })} />
                </td>
                <td>
                  <input className="input w-full" value={r.displayName ?? ''} onChange={(e) => update(idx, { displayName: e.target.value })} placeholder={r.enumeratorId === supervisorEnumeratorId ? 'Supervisor' : ''} />
                </td>
                <td><input type="checkbox" checked={r.measuresMuac} onChange={(e) => update(idx, { measuresMuac: e.target.checked })} /></td>
                <td><input type="checkbox" checked={r.measuresWeight} onChange={(e) => update(idx, { measuresWeight: e.target.checked })} /></td>
                <td><input type="checkbox" checked={r.measuresHeight} onChange={(e) => update(idx, { measuresHeight: e.target.checked })} /></td>
                <td className="text-right">
                  <button className="btn" onClick={() => remove(idx)} type="button">Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-between mt-3">
          <button className="btn" onClick={addRow} type="button">+ Add enumerator</button>
          <div className="flex items-center gap-2">
            {savedNote && <span className="chip chip-pass">{savedNote}</span>}
            <button className="btn btn-primary" onClick={save} disabled={pending} type="button">
              {pending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
