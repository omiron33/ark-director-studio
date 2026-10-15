// Small, race-safe edits to a project. The client never sends a whole project back; it sends ops
// addressed by ids, so a job writing a take and a person editing a prompt never overwrite each other.
//   { op: 'set', path: ['sequences', 'q1', 'shots', 's1', 'prompt'], value: '...' }
//   { op: 'insert', path: ['sequences', 'q1', 'shots'], value: {...}, index?: 2 }
//   { op: 'remove', path: ['sequences', 'q1', 'shots', 's1'] }
//   { op: 'move', path: ['sequences', 'q1', 'shots'], id: 's1', index: 0, to?: ['sequences', 'q2', 'shots'] }
// A path step into an array is an element's id (or a numeric index).
import { newShot, newSequence, uid, shotDefaults } from './store.ts';
import type { Project } from '../shared/types.ts';

export type Op =
  | { op: 'set'; path: (string | number)[]; value: unknown }
  | { op: 'insert'; path: (string | number)[]; value: any; index?: number }
  | { op: 'remove'; path: (string | number)[] }
  | { op: 'move'; path: (string | number)[]; id: string; index: number; to?: (string | number)[] };

const PROTECTED = new Set(['id', 'created', 'updated']);

function step(node: any, key: string | number) {
  if (Array.isArray(node)) {
    const i = typeof key === 'number' ? key : node.findIndex((x) => x?.id === key);
    if (i < 0 || i >= node.length) throw Error(`no element ${key}`);
    return { parent: node, key: i, value: node[i] };
  }
  if (node && typeof node === 'object') return { parent: node, key, value: node[key] };
  throw Error(`cannot step into ${key}`);
}
function walk(root: any, path: (string | number)[]) {
  let node = root;
  for (const k of path) node = step(node, k).value;
  return node;
}

// New elements get fresh ids and full defaults.
function fill(p: Project, path: (string | number)[], value: any) {
  const last = path[path.length - 1];
  if (last === 'shots') return newShot({ ...shotDefaults(p), ...value });
  if (last === 'sequences') return { ...newSequence(value?.title), ...value, id: uid('q') };
  if (last === 'cast') return { id: uid('c'), name: 'New character', description: '', ...value };
  if (last === 'looks') return { id: uid('l'), name: 'New look', prompt: '', ...value };
  if (last === 'actors' || last === 'props') return value;
  return value?.id ? value : { id: uid(), ...value };
}

export function applyOps(p: Project, ops: Op[]) {
  for (const o of ops ?? []) {
    if (!o.path?.length) throw Error('an op needs a path');
    if (o.op === 'set') {
      const parentPath = o.path.slice(0, -1);
      const key = o.path[o.path.length - 1];
      if (parentPath.length === 0 && PROTECTED.has(String(key))) throw Error(`${key} cannot be changed`);
      const parent = walk(p, parentPath);
      const s = step(parent, key);
      s.parent[s.key] = o.value;
    } else if (o.op === 'insert') {
      const arr = walk(p, o.path);
      if (!Array.isArray(arr)) throw Error('insert needs an array');
      const v = fill(p, o.path, o.value);
      arr.splice(o.index ?? arr.length, 0, v);
    } else if (o.op === 'remove') {
      const parent = walk(p, o.path.slice(0, -1));
      const s = step(parent, o.path[o.path.length - 1]);
      if (!Array.isArray(s.parent)) throw Error('remove needs an array element');
      s.parent.splice(s.key as number, 1);
    } else if (o.op === 'move') {
      const from = walk(p, o.path);
      const to = o.to ? walk(p, o.to) : from;
      const i = from.findIndex((x: any) => x?.id === o.id);
      if (i < 0) throw Error(`no element ${o.id}`);
      const [el] = from.splice(i, 1);
      to.splice(Math.max(0, Math.min(o.index, to.length)), 0, el);
    }
  }
}
