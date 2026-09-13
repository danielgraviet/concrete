import { useMemo } from 'react';
import { NoteGraph, type BacklinkHit, type GraphNote } from './NoteGraph';

/**
 * Rebuilds the note graph when `notes` change and returns backlinks
 * for the currently selected note path.
 */
export function useBacklinks(
  selectedPath: string | null | undefined,
  notes: GraphNote[],
): {
  backlinks: BacklinkHit[];
  outgoing: BacklinkHit[];
  unresolved: string[];
  graph: NoteGraph;
} {
  const graph = useMemo(() => new NoteGraph().build(notes), [notes]);

  const backlinks = useMemo(
    () => (selectedPath ? graph.getBacklinks(selectedPath) : []),
    [graph, selectedPath],
  );

  const outgoing = useMemo(
    () => (selectedPath ? graph.getOutgoing(selectedPath) : []),
    [graph, selectedPath],
  );

  const unresolved = useMemo(
    () => (selectedPath ? graph.getUnresolved(selectedPath) : []),
    [graph, selectedPath],
  );

  return { backlinks, outgoing, unresolved, graph };
}
