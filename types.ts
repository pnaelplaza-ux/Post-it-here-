export interface Point {
  x: number;
  y: number;
}

export interface NoteData {
  id: string;
  x: number;
  y: number;
  text: string;
  color: NoteColor;
  rotation: number;
  timestamp: number;
  authorId?: string; // Anonymous UID
}

export interface StampData {
  id: string;
  x: number;
  y: number;
  emoji: string;
  rotation: number;
  timestamp: number;
}

export interface LinkData {
  id: string;
  sourceId: string;
  targetId: string;
  chunkKey: string; // Keep track of where we stored it
}

export interface CursorData {
  id: string;
  x: number;
  y: number;
  color: string;
  lastUpdate: number;
}

export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

export enum NoteColor {
  Yellow = '#fef08a', // yellow-200
  Blue = '#bfdbfe',   // blue-200
  Green = '#bbf7d0',  // green-200
  Pink = '#fecdd3',   // rose-200
  Orange = '#fed7aa', // orange-200
}

export const CHUNK_SIZE = 500;

export type ChunkKey = string; // Format: "x_y" e.g., "1_-2"

export type ToolMode = 'pan' | 'stamp' | 'link';

export interface SearchResult {
  id: string;
  text: string;
  x: number;
  y: number;
  color: NoteColor;
}

export interface InfiniteCanvasHandle {
  searchNotes: (query: string) => SearchResult[];
  injectNote: (note: NoteData) => void;
  injectStamp: (stamp: StampData) => void;
  getNoteAt: (point: Point) => NoteData | null;
  moveNoteLocally: (note: NoteData, newPos: Point) => void;
  addLinkLocally: (link: LinkData) => void;
}