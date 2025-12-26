import React, { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import { ref, get, query, orderByChild, startAt } from 'firebase/database';
import { db, isDemoMode, auth } from '../firebaseConfig';
import { Viewport, NoteData, StampData, CursorData, CHUNK_SIZE, ChunkKey, Point, InfiniteCanvasHandle, SearchResult, LinkData } from '../types';
import { drawNote, drawStamp, drawCursor, hitTestNote, drawLink } from '../utils/canvasUtils';

interface InfiniteCanvasProps {
  viewport: Viewport;
  onViewportChange: (newViewport: Viewport) => void;
  onCanvasDragStart: (e: React.MouseEvent | React.TouchEvent) => void;
  onCanvasClick: (point: Point) => void;
  onCanvasDoubleClick: (point: Point) => void;
  newNotePreview?: NoteData | null;
  cursors: CursorData[]; 
}

const VISIBILITY_WINDOW_MS = 24 * 60 * 60 * 1000; 

const InfiniteCanvas = forwardRef<InfiniteCanvasHandle, InfiniteCanvasProps>(({ 
  viewport, 
  onCanvasDragStart,
  onCanvasClick,
  onCanvasDoubleClick,
  newNotePreview,
  cursors
}, refForwarded) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Data State
  const chunksRef = useRef<Map<ChunkKey, NoteData[]>>(new Map());
  const stampChunksRef = useRef<Map<ChunkKey, StampData[]>>(new Map());
  const linksChunksRef = useRef<Map<ChunkKey, LinkData[]>>(new Map());
  
  const loadedChunksRef = useRef<Set<ChunkKey>>(new Set());
  const lastRangeRef = useRef<string>("");
  const [forceRender, setForceRender] = useState(0); 
  
  // Local wrapper for isDemoMode
  const [isDemo, setIsDemo] = useState(isDemoMode);
  
  // Track note being hovered or dragged for highlighting
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  useEffect(() => {
    const handleFallback = () => {
        loadedChunksRef.current.clear();
        chunksRef.current.clear();
        stampChunksRef.current.clear();
        linksChunksRef.current.clear();
        lastRangeRef.current = ""; 
        setIsDemo(true);
    };
    window.addEventListener('switch-to-demo-mode', handleFallback);
    return () => window.removeEventListener('switch-to-demo-mode', handleFallback);
  }, []);

  // --- Exposed Methods ---
  useImperativeHandle(refForwarded, () => ({
    searchNotes: (query: string): SearchResult[] => {
      const lowerQuery = query.toLowerCase();
      const results: SearchResult[] = [];
      if (!query.trim()) return [];

      const source = isDemo ? getLocalStorageNotes() : chunksRef.current;
      if (source instanceof Map) {
          source.forEach((notes) => {
            notes.forEach(note => {
                if (note.text && note.text.toLowerCase().includes(lowerQuery)) {
                results.push({
                    id: note.id,
                    text: note.text,
                    x: note.x,
                    y: note.y,
                    color: note.color
                });
                }
            });
         });
      }
      return results.sort((a, b) => a.text.length - b.text.length).slice(0, 20); 
    },
    injectNote: (note: NoteData) => {
        const cx = Math.floor(note.x / CHUNK_SIZE);
        const cy = Math.floor(note.y / CHUNK_SIZE);
        const key = `${cx}_${cy}`;
        const current = chunksRef.current.get(key) || [];
        chunksRef.current.set(key, [...current, note]);
        setForceRender(n => n + 1);
    },
    injectStamp: (stamp: StampData) => {
        const cx = Math.floor(stamp.x / CHUNK_SIZE);
        const cy = Math.floor(stamp.y / CHUNK_SIZE);
        const key = `${cx}_${cy}`;
        const current = stampChunksRef.current.get(key) || [];
        stampChunksRef.current.set(key, [...current, stamp]);
        setForceRender(n => n + 1);
    },
    getNoteAt: (point: Point): NoteData | null => {
        // Search loaded chunks. Reverse order isn't strictly necessary with chunks map, 
        // but we should check all relevant chunks.
        // Optimization: Check closest chunk first?
        // Simple iteration over all loaded chunks is fast enough for <1000 items.
        
        let found: NoteData | null = null;
        // Iterate backwards through chunks to find "topmost" note conceptually, 
        // though chunks are spatial.
        for (const [key, notes] of chunksRef.current) {
            // Reverse loop through notes in chunk (top drawn is last)
            for (let i = notes.length - 1; i >= 0; i--) {
                if (hitTestNote(notes[i], point.x, point.y)) {
                    found = notes[i];
                    setSelectedNoteId(found.id);
                    return found;
                }
            }
        }
        setSelectedNoteId(null);
        return null;
    },
    moveNoteLocally: (note: NoteData, newPos: Point) => {
        // 1. Find the note in its CURRENT chunk (based on note.x, note.y BEFORE update)
        // note passed here is the "old" note data usually, but React state might vary.
        // We scan all chunks to find note by ID to be safe.
        
        let oldChunkKey = "";
        let found = false;
        
        for (const [key, notes] of chunksRef.current) {
            const idx = notes.findIndex(n => n.id === note.id);
            if (idx !== -1) {
                // Remove from old location
                notes.splice(idx, 1);
                oldChunkKey = key;
                found = true;
                break;
            }
        }

        if (!found) return; // Should not happen

        // 2. Update properties
        const updatedNote = { ...note, x: newPos.x, y: newPos.y };

        // 3. Determine NEW chunk
        const cx = Math.floor(newPos.x / CHUNK_SIZE);
        const cy = Math.floor(newPos.y / CHUNK_SIZE);
        const newChunkKey = `${cx}_${cy}`;

        // 4. Add to new chunk
        const targetChunk = chunksRef.current.get(newChunkKey);
        if (targetChunk) {
            targetChunk.push(updatedNote);
        } else {
            chunksRef.current.set(newChunkKey, [updatedNote]);
        }
        
        setSelectedNoteId(note.id);
        setForceRender(n => n + 1);
    },
    addLinkLocally: (link: LinkData) => {
        const list = linksChunksRef.current.get(link.chunkKey) || [];
        linksChunksRef.current.set(link.chunkKey, [...list, link]);
        setForceRender(n => n + 1);
    }
  }));

  const getLocalStorageNotes = () => {
      const map = new Map<ChunkKey, NoteData[]>();
      Object.keys(localStorage).forEach(key => {
          if (key.startsWith('chunk_') && !key.startsWith('chunk_stamps_') && !key.startsWith('chunk_links_')) {
              try {
                  const chunkKey = key.replace('chunk_', '');
                  const notes = JSON.parse(localStorage.getItem(key) || '{}');
                  map.set(chunkKey, Object.values(notes));
              } catch(e) {}
          }
      });
      return map;
  }

  // --- Chunk Management ---

  const loadVisibleChunks = useCallback(async (startCx: number, endCx: number, startCy: number, endCy: number) => {
    const timeCutoff = Date.now() - VISIBILITY_WINDOW_MS;

    for (let x = startCx; x <= endCx; x++) {
      for (let y = startCy; y <= endCy; y++) {
        const key = `${x}_${y}`;
        
        if (loadedChunksRef.current.has(key)) continue;
        loadedChunksRef.current.add(key);

        if (isDemo || !db) {
            // Local Storage
            const jsonNotes = localStorage.getItem(`chunk_${key}`);
            const dataNotes = jsonNotes ? JSON.parse(jsonNotes) : {};
            chunksRef.current.set(key, Object.values(dataNotes) as NoteData[]);

            const jsonStamps = localStorage.getItem(`chunk_stamps_${key}`);
            const dataStamps = jsonStamps ? JSON.parse(jsonStamps) : {};
            stampChunksRef.current.set(key, Object.values(dataStamps) as StampData[]);

            const jsonLinks = localStorage.getItem(`chunk_links_${key}`);
            const dataLinks = jsonLinks ? JSON.parse(jsonLinks) : {};
            linksChunksRef.current.set(key, Object.values(dataLinks) as LinkData[]);
            
            setForceRender(n => n + 1);
        } else {
            try {
                const notesQuery = query(ref(db, `chunks/${key}`), orderByChild('timestamp'), startAt(timeCutoff));
                const stampsQuery = query(ref(db, `stamps/${key}`), orderByChild('timestamp'), startAt(timeCutoff));
                // Load links for this chunk
                const linksQuery = query(ref(db, `links/${key}`));

                const [notesSnap, stampsSnap, linksSnap] = await Promise.all([
                    get(notesQuery),
                    get(stampsQuery),
                    get(linksQuery)
                ]);

                chunksRef.current.set(key, notesSnap.exists() ? Object.values(notesSnap.val()) : []);
                stampChunksRef.current.set(key, stampsSnap.exists() ? Object.values(stampsSnap.val()) : []);
                linksChunksRef.current.set(key, linksSnap.exists() ? Object.values(linksSnap.val()) : []);
                
                setForceRender(n => n + 1);
            } catch (err) {
                console.error("Error loading chunk:", key, err);
                loadedChunksRef.current.delete(key);
            }
        }
      }
    }
  }, [isDemo]);

  // Viewport/Chunk Effect
  useEffect(() => {
    if (!containerRef.current) return;
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;
    
    const left = -viewport.x / viewport.scale;
    const top = -viewport.y / viewport.scale;
    const right = (width - viewport.x) / viewport.scale;
    const bottom = (height - viewport.y) / viewport.scale;

    const buffer = CHUNK_SIZE * 0.5; 
    const startCx = Math.floor((left - buffer) / CHUNK_SIZE);
    const endCx = Math.floor((right + buffer) / CHUNK_SIZE);
    const startCy = Math.floor((top - buffer) / CHUNK_SIZE);
    const endCy = Math.floor((bottom + buffer) / CHUNK_SIZE);

    const rangeKey = `${startCx}_${endCx}_${startCy}_${endCy}`;

    if (rangeKey !== lastRangeRef.current) {
        lastRangeRef.current = rangeKey;
        loadVisibleChunks(startCx, endCx, startCy, endCy);
    }
  }, [viewport, loadVisibleChunks]);

  // Demo Local Updates
  useEffect(() => {
    if (!isDemo) return;
    const handleLocalUpdate = (e: Event) => {
        const customEvent = e as CustomEvent;
        const key = customEvent.detail?.chunkKey;
        if (key && loadedChunksRef.current.has(key)) {
           // Quick crude reload
           if (customEvent.detail?.type === 'stamp') {
             const json = localStorage.getItem(`chunk_stamps_${key}`);
             const data = json ? JSON.parse(json) : {};
             stampChunksRef.current.set(key, Object.values(data));
           } else if (customEvent.detail?.type === 'link') {
             const json = localStorage.getItem(`chunk_links_${key}`);
             const data = json ? JSON.parse(json) : {};
             linksChunksRef.current.set(key, Object.values(data));
           } else {
             const json = localStorage.getItem(`chunk_${key}`);
             const data = json ? JSON.parse(json) : {};
             chunksRef.current.set(key, Object.values(data));
           }
           setForceRender(n => n + 1);
        }
    };
    window.addEventListener('local-storage-update', handleLocalUpdate);
    return () => window.removeEventListener('local-storage-update', handleLocalUpdate);
  }, [isDemo]);

  // --- Input Handlers ---
  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => onCanvasDragStart(e);

  const handleClick = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if(!rect) return;
    const x = (e.clientX - rect.left - viewport.x) / viewport.scale;
    const y = (e.clientY - rect.top - viewport.y) / viewport.scale;
    onCanvasClick({x, y});
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if(!rect) return;
    const x = (e.clientX - rect.left - viewport.x) / viewport.scale;
    const y = (e.clientY - rect.top - viewport.y) / viewport.scale;
    onCanvasDoubleClick({x, y});
  };

  // --- Render Loop ---
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    
    ctx.translate(viewport.x, viewport.y);
    ctx.scale(viewport.scale, viewport.scale);

    const left = -viewport.x / viewport.scale;
    const top = -viewport.y / viewport.scale;
    const right = (canvas.width - viewport.x) / viewport.scale;
    const bottom = (canvas.height - viewport.y) / viewport.scale;

    // Grid
    ctx.fillStyle = '#cbd5e1'; 
    const gridSize = 40;
    const startGridX = Math.floor(left / gridSize) * gridSize;
    const startGridY = Math.floor(top / gridSize) * gridSize;

    for (let x = startGridX; x < right; x += gridSize) {
        for (let y = startGridY; y < bottom; y += gridSize) {
            ctx.beginPath();
            ctx.arc(x, y, 1.5 / viewport.scale, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    const renderBuffer = 1; 
    const minCx = Math.floor(left / CHUNK_SIZE) - renderBuffer;
    const maxCx = Math.floor(right / CHUNK_SIZE) + renderBuffer;
    const minCy = Math.floor(top / CHUNK_SIZE) - renderBuffer;
    const maxCy = Math.floor(bottom / CHUNK_SIZE) + renderBuffer;

    // 0. Prepare Lookups for Links
    // We need to find note positions to draw links.
    // Optimization: Create a flat map of all currently visible notes? 
    // Or just search efficiently.
    const visibleNotesMap = new Map<string, NoteData>();
    for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cy = minCy; cy <= maxCy; cy++) {
            const key = `${cx}_${cy}`;
            const notes = chunksRef.current.get(key);
            if (notes) notes.forEach(n => visibleNotesMap.set(n.id, n));
        }
    }

    // 1. Draw Links (Bottom layer)
    for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cy = minCy; cy <= maxCy; cy++) {
            const key = `${cx}_${cy}`;
            const links = linksChunksRef.current.get(key);
            if (links) {
                for (const link of links) {
                    const source = visibleNotesMap.get(link.sourceId);
                    const target = visibleNotesMap.get(link.targetId);
                    if (source && target) {
                        drawLink(ctx, source, target);
                    }
                }
            }
        }
    }

    // 2. Draw Stamps
    for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cy = minCy; cy <= maxCy; cy++) {
            const key = `${cx}_${cy}`;
            const stamps = stampChunksRef.current.get(key);
            if (stamps) {
                for (const stamp of stamps) drawStamp(ctx, stamp);
            }
        }
    }

    // 3. Draw Notes
    for (let cx = minCx; cx <= maxCx; cx++) {
        for (let cy = minCy; cy <= maxCy; cy++) {
            const key = `${cx}_${cy}`;
            const notes = chunksRef.current.get(key);
            if (notes) {
                for (const note of notes) {
                    drawNote(ctx, note, note.id === selectedNoteId);
                }
            }
        }
    }
    
    // 4. Preview
    if (newNotePreview) {
        ctx.globalAlpha = 0.8;
        drawNote(ctx, newNotePreview, true);
        ctx.globalAlpha = 1.0;
    }

    // 5. Cursors
    cursors.forEach(cursor => {
        if(cursor.id !== auth?.currentUser?.uid) drawCursor(ctx, cursor);
    });

    ctx.restore();

  }, [viewport, forceRender, newNotePreview, cursors, selectedNoteId]);

  return (
    <div 
      ref={containerRef} 
      className={`absolute inset-0 overflow-hidden bg-[#f3f3f3] ${cursors.length > 0 ? 'cursor-default' : 'cursor-crosshair'}`} // Adjust cursor dynamically?
      style={{ cursor: 'url("data:image/svg+xml;utf8,<svg width=\'24\' height=\'24\' viewBox=\'0 0 24 24\' fill=\'none\' xmlns=\'http://www.w3.org/2000/svg\'><path d=\'M5.65376 12.3673H5.46026L5.31717 12.4976L0.500002 16.8829L0.500002 1.19841L11.7841 12.3673H5.65376Z\' fill=\'black\' stroke=\'white\'/></svg>") 0 0, auto' }}
      onMouseDown={handlePointerDown}
      onTouchStart={handlePointerDown}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
});

export default InfiniteCanvas;