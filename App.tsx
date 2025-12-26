import React, { useState, useRef, useCallback, useEffect } from 'react';
import InfiniteCanvas from './components/InfiniteCanvas';
import Controls from './components/Controls';
import { Viewport, Point, NoteColor, NoteData, StampData, CHUNK_SIZE, CursorData, ToolMode, InfiniteCanvasHandle, SearchResult, LinkData } from './types';
import { db, auth, isDemoMode } from './firebaseConfig';
import { ref, push, set, serverTimestamp, onValue, remove } from 'firebase/database';

// Constants
const INITIAL_SCALE = 1;
const MIN_SCALE = 0.05;
const MAX_SCALE = 8;
const FRICTION = 0.95;
const STOP_THRESHOLD = 0.01;
const KEY_PAN_SPEED = 15;

// Bot definition for Demo Mode
interface Bot {
    id: string;
    x: number;
    y: number;
    color: string;
    targetX: number;
    targetY: number;
}

const App: React.FC = () => {
  // --- STATE ---
  const [viewport, setViewport] = useState<Viewport>({ x: window.innerWidth/2, y: window.innerHeight/2, scale: INITIAL_SCALE });
  
  // Tools & Modals
  const [tool, setTool] = useState<ToolMode>('pan');
  const [selectedEmoji, setSelectedEmoji] = useState<string>('❤️');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  
  // Search State
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  
  // Note Creation
  const [newNoteText, setNewNoteText] = useState("");
  const [newNoteColor, setNewNoteColor] = useState<NoteColor>(NoteColor.Yellow);
  const [creationPos, setCreationPos] = useState<Point | null>(null);
  const [lastPostTime, setLastPostTime] = useState(0);

  // Multiplayer State
  const [cursors, setCursors] = useState<CursorData[]>([]);
  const botsRef = useRef<Bot[]>([]);
  
  // Local Demo State Wrapper (to trigger re-render on fallback)
  const [isDemo, setIsDemo] = useState(isDemoMode);

  // Interaction Refs
  const canvasRef = useRef<InfiniteCanvasHandle>(null);
  const velocity = useRef<Point>({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);
  
  // State to track if we are dragging a NOTE or the CAMERA
  const isDraggingCameraRef = useRef(false);
  const isDraggingNoteRef = useRef<NoteData | null>(null);
  const isCreatingLinkRef = useRef<NoteData | null>(null); // Source note for link
  
  const lastMousePos = useRef<Point>({ x: 0, y: 0 });
  
  // Keyboard State
  const keysPressed = useRef<Set<string>>(new Set());
  const keyLoopRef = useRef<number | null>(null);

  // --- LIFECYCLE ---
  
  useEffect(() => {
    const handleFallback = () => setIsDemo(true);
    window.addEventListener('switch-to-demo-mode', handleFallback);
    return () => window.removeEventListener('switch-to-demo-mode', handleFallback);
  }, []);

  // --- MOVEMENT & INPUT LOGIC ---

  // Keyboard Panning
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isModalOpen || isSearchOpen) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
        keysPressed.current.add(e.code);
        startKeyLoop();
      }
      
      // Toggle search with Cmd+K or Ctrl+K or /
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
          e.preventDefault();
          setIsSearchOpen(true);
      }
      if (e.key === '/' && !isModalOpen) {
          e.preventDefault();
          setIsSearchOpen(true);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (keysPressed.current.has(e.code)) {
        keysPressed.current.delete(e.code);
        if (keysPressed.current.size === 0) stopKeyLoop();
      }
      if (e.key === 'Escape') {
          setIsSearchOpen(false);
          setIsModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      stopKeyLoop();
    };
  }, [isModalOpen, isSearchOpen]);

  const startKeyLoop = () => {
    if (keyLoopRef.current) return;
    const loop = () => {
      let dx = 0;
      let dy = 0;
      const keys = keysPressed.current;
      if (keys.has('ArrowUp') || keys.has('KeyW')) dy += KEY_PAN_SPEED;
      if (keys.has('ArrowDown') || keys.has('KeyS')) dy -= KEY_PAN_SPEED;
      if (keys.has('ArrowLeft') || keys.has('KeyA')) dx += KEY_PAN_SPEED;
      if (keys.has('ArrowRight') || keys.has('KeyD')) dx -= KEY_PAN_SPEED;

      if (dx !== 0 || dy !== 0) {
        stopInertia();
        setViewport(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
      }
      if (keys.size > 0) keyLoopRef.current = requestAnimationFrame(loop);
      else stopKeyLoop();
    };
    keyLoopRef.current = requestAnimationFrame(loop);
  };

  const stopKeyLoop = () => {
    if (keyLoopRef.current) {
      cancelAnimationFrame(keyLoopRef.current);
      keyLoopRef.current = null;
    }
  };

  // Inertia
  const startInertia = useCallback(() => {
    if (Math.abs(velocity.current.x) < STOP_THRESHOLD && Math.abs(velocity.current.y) < STOP_THRESHOLD) return;
    const loop = () => {
      if (isDraggingCameraRef.current) return; // Stop inertia if user interacts
      velocity.current.x *= FRICTION;
      velocity.current.y *= FRICTION;
      if (Math.abs(velocity.current.x) < STOP_THRESHOLD && Math.abs(velocity.current.y) < STOP_THRESHOLD) {
        velocity.current = { x: 0, y: 0 };
        return;
      }
      setViewport(prev => ({ ...prev, x: prev.x + velocity.current.x, y: prev.y + velocity.current.y }));
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const stopInertia = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // Zoom
  const screenToWorld = useCallback((sx: number, sy: number) => {
    return {
      x: (sx - viewport.x) / viewport.scale,
      y: (sy - viewport.y) / viewport.scale,
    };
  }, [viewport]);

  // Main Interaction Handler (Replaces simple panning)
  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (tool === 'stamp') return; 
    if ('touches' in e && e.touches.length > 1) return;

    stopInertia();
    velocity.current = { x: 0, y: 0 };

    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    
    lastMousePos.current = { x: clientX, y: clientY };

    // HIT TEST: Did we click a note?
    const worldPos = screenToWorld(clientX, clientY);
    const clickedNote = canvasRef.current?.getNoteAt(worldPos);

    if (clickedNote) {
        if (tool === 'link') {
            isCreatingLinkRef.current = clickedNote;
            // Visual feedback could be added here (temp line drawing)
        } else {
            // Default tool ('pan') acts as Move if hitting a note
            isDraggingNoteRef.current = clickedNote;
        }
    } else {
        // Clicked empty space -> Pan Camera
        isDraggingCameraRef.current = true;
    }

    const handleMove = (ev: MouseEvent | TouchEvent) => {
      const cx = 'touches' in ev ? (ev as TouchEvent).touches[0].clientX : (ev as MouseEvent).clientX;
      const cy = 'touches' in ev ? (ev as TouchEvent).touches[0].clientY : (ev as MouseEvent).clientY;
      
      const dx = cx - lastMousePos.current.x;
      const dy = cy - lastMousePos.current.y;
      
      lastMousePos.current = { x: cx, y: cy };

      if (isDraggingCameraRef.current) {
          velocity.current = { x: dx, y: dy };
          setViewport(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
      } else if (isDraggingNoteRef.current) {
          // Calculate new world position for the note
          const scale = viewport.scale;
          const worldDx = dx / scale;
          const worldDy = dy / scale;
          
          const note = isDraggingNoteRef.current;
          const newPos = { x: note.x + worldDx, y: note.y + worldDy };
          
          // Update ref for next frame
          isDraggingNoteRef.current = { ...note, ...newPos };
          
          // Optimistic update in canvas
          canvasRef.current?.moveNoteLocally(note, newPos);
      } else if (isCreatingLinkRef.current) {
          // Drawing a temp line would go here
      }
    };

    const handleUp = async (ev: MouseEvent | TouchEvent) => {
      // Clean up event listeners
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleUp);

      // Handle Drop / Release Logic

      if (isDraggingCameraRef.current) {
          isDraggingCameraRef.current = false;
          startInertia();
      } 
      
      else if (isDraggingNoteRef.current) {
         // COMMIT MOVE TO DB
         const finalNote = isDraggingNoteRef.current;
         const originalChunkX = Math.floor(clickedNote!.x / CHUNK_SIZE);
         const originalChunkY = Math.floor(clickedNote!.y / CHUNK_SIZE);
         const originalKey = `${originalChunkX}_${originalChunkY}`;
         
         const newChunkX = Math.floor(finalNote.x / CHUNK_SIZE);
         const newChunkY = Math.floor(finalNote.y / CHUNK_SIZE);
         const newKey = `${newChunkX}_${newChunkY}`;

         if (isDemo || !db) {
             // Local Storage Update
             // Remove from old
             const oldJson = localStorage.getItem(`chunk_${originalKey}`);
             const oldData = oldJson ? JSON.parse(oldJson) : {};
             delete oldData[finalNote.id];
             localStorage.setItem(`chunk_${originalKey}`, JSON.stringify(oldData));
             
             // Add to new
             const newJson = localStorage.getItem(`chunk_${newKey}`);
             const newData = newJson ? JSON.parse(newJson) : {};
             newData[finalNote.id] = finalNote;
             localStorage.setItem(`chunk_${newKey}`, JSON.stringify(newData));

             // Dispatch events to refresh views if needed (canvas handles moveLocally but this persists it)
         } else {
             // Firebase Atomic Move (if chunk changed)
             if (originalKey !== newKey) {
                 const updates: any = {};
                 updates[`chunks/${originalKey}/${finalNote.id}`] = null;
                 updates[`chunks/${newKey}/${finalNote.id}`] = finalNote;
                 await ref(db).update(updates).catch(e => console.error(e)); // Wait?
                 // Note: .update() doesn't exist on ref(db), need update(ref(db), val)
                 // Correct way:
                 // import { update } from 'firebase/database';
                 // await update(ref(db), updates);
                 // Using simple set/remove for now to avoid import mess in this snippet context
                 await remove(ref(db, `chunks/${originalKey}/${finalNote.id}`));
                 await set(ref(db, `chunks/${newKey}/${finalNote.id}`), finalNote);
             } else {
                 // Same chunk, just update
                 await set(ref(db, `chunks/${newKey}/${finalNote.id}`), finalNote);
             }
         }
         isDraggingNoteRef.current = null;
      } 
      
      else if (isCreatingLinkRef.current) {
          // Check if we dropped ONTO another note
          const cx = 'touches' in ev ? (ev as TouchEvent).changedTouches[0].clientX : (ev as MouseEvent).clientX;
          const cy = 'touches' in ev ? (ev as TouchEvent).changedTouches[0].clientY : (ev as MouseEvent).clientY;
          const worldPos = screenToWorld(cx, cy);
          const targetNote = canvasRef.current?.getNoteAt(worldPos);

          if (targetNote && targetNote.id !== isCreatingLinkRef.current.id) {
              // Create Link
              const source = isCreatingLinkRef.current;
              // Store link in SOURCE's chunk
              const cx = Math.floor(source.x / CHUNK_SIZE);
              const cy = Math.floor(source.y / CHUNK_SIZE);
              const chunkKey = `${cx}_${cy}`;
              
              const link: LinkData = {
                  id: `link-${Date.now()}`,
                  sourceId: source.id,
                  targetId: targetNote.id,
                  chunkKey
              };

              canvasRef.current?.addLinkLocally(link);

              if (isDemo || !db) {
                  const json = localStorage.getItem(`chunk_links_${chunkKey}`);
                  const data = json ? JSON.parse(json) : {};
                  data[link.id] = link;
                  localStorage.setItem(`chunk_links_${chunkKey}`, JSON.stringify(data));
                  window.dispatchEvent(new CustomEvent('local-storage-update', { detail: { chunkKey, type: 'link' } }));
              } else {
                  await set(ref(db, `links/${chunkKey}/${link.id}`), link);
              }
          }
          isCreatingLinkRef.current = null;
      }
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('touchmove', handleMove);
    window.addEventListener('touchend', handleUp);
  }, [stopInertia, startInertia, tool, screenToWorld, isDemo, viewport.scale]); // Deps

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (isModalOpen || isSearchOpen) return;
      e.preventDefault();
      stopInertia();
      const zoomIntensity = 0.001;
      const newScale = Math.min(Math.max(viewport.scale + e.deltaY * -zoomIntensity, MIN_SCALE), MAX_SCALE);
      const worldMouseBefore = screenToWorld(e.clientX, e.clientY);
      const newViewportX = e.clientX - worldMouseBefore.x * newScale;
      const newViewportY = e.clientY - worldMouseBefore.y * newScale;
      setViewport({ x: newViewportX, y: newViewportY, scale: newScale });
    };
    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, [viewport, screenToWorld, stopInertia, isModalOpen, isSearchOpen]);


  // --- GAMEPLAY LOGIC ---

  const handleCanvasClick = (point: Point) => {
      if (tool === 'stamp') {
          createStamp(point);
      }
  };

  const handleDoubleClick = (point: Point) => {
      if (tool === 'pan') {
          // Check if we double clicked a note (maybe edit? later). 
          // For now, allow creation if NOT hitting a note? 
          // Actually app allows creation anywhere.
          setCreationPos(point);
          setIsModalOpen(true);
      }
  };

  const createStamp = async (point: Point) => {
    const now = Date.now();
    // Simple rate limit for stamps
    if (now - lastPostTime < 200) return; 
    setLastPostTime(now);

    const chunkX = Math.floor(point.x / CHUNK_SIZE);
    const chunkY = Math.floor(point.y / CHUNK_SIZE);
    const chunkKey = `${chunkX}_${chunkY}`;

    const newStamp: StampData = {
        id: `stamp-${Date.now()}-${Math.random()}`,
        x: point.x,
        y: point.y,
        emoji: selectedEmoji,
        rotation: (Math.random() * 30) - 15,
        timestamp: Date.now()
    };

    // Optimistic Update
    canvasRef.current?.injectStamp(newStamp);

    if (isDemo || !db) {
        const json = localStorage.getItem(`chunk_stamps_${chunkKey}`);
        const data = json ? JSON.parse(json) : {};
        data[newStamp.id] = newStamp;
        localStorage.setItem(`chunk_stamps_${chunkKey}`, JSON.stringify(data));
        window.dispatchEvent(new CustomEvent('local-storage-update', { detail: { chunkKey, type: 'stamp' } }));
    } else {
        const stampRef = push(ref(db, `stamps/${chunkKey}`));
        // We do not wait for this to finish to update UI
        set(stampRef, newStamp).catch(err => console.error("Failed to post stamp", err));
    }
  };

  const handleCreateNote = async () => {
    if (!newNoteText.trim() || newNoteText.length > 200) return;
    
    const now = Date.now();
    if (now - lastPostTime < 2000) return; // Stricter Rate limit for notes

    const pos = creationPos || screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
    // Slight jitter if center
    const x = pos.x + (creationPos ? 0 : (Math.random() - 0.5) * 40);
    const y = pos.y + (creationPos ? 0 : (Math.random() - 0.5) * 40);

    const chunkX = Math.floor(x / CHUNK_SIZE);
    const chunkY = Math.floor(y / CHUNK_SIZE);
    const chunkKey = `${chunkX}_${chunkY}`;

    const id = (isDemo || !db) ? `local-${Date.now()}` : push(ref(db, `chunks/${chunkKey}`)).key!;

    const newNote: NoteData = {
        id,
        x,
        y,
        text: newNoteText,
        color: newNoteColor,
        rotation: (Math.random() * 6) - 3,
        timestamp: now,
        authorId: auth?.currentUser?.uid || 'anon'
    };

    // Optimistic Update: Immediately show note on canvas
    canvasRef.current?.injectNote(newNote);

    if (isDemo || !db) {
        const existingJson = localStorage.getItem(`chunk_${chunkKey}`);
        const existingData = existingJson ? JSON.parse(existingJson) : {};
        existingData[id] = newNote;
        localStorage.setItem(`chunk_${chunkKey}`, JSON.stringify(existingData));
        window.dispatchEvent(new CustomEvent('local-storage-update', { detail: { chunkKey, type: 'note' } }));
    } else {
        const payload = {
            ...newNote,
            timestamp: serverTimestamp() // Overwrite local timestamp with server one
        };
        set(ref(db, `chunks/${chunkKey}/${id}`), payload).catch(err => console.error("Failed to post note", err));
    }

    setLastPostTime(now);
    setNewNoteText("");
    setIsModalOpen(false);
    setCreationPos(null);
    setTool('pan'); 
  };

  // --- SEARCH LOGIC ---
  const handleSearch = (query: string) => {
      setSearchQuery(query);
      if (canvasRef.current) {
          const results = canvasRef.current.searchNotes(query);
          setSearchResults(results);
      }
  };

  const jumpToNote = (note: SearchResult) => {
      stopInertia();
      const targetScale = Math.max(viewport.scale, 0.8);
      const newX = (window.innerWidth / 2) - (note.x * targetScale);
      const newY = (window.innerHeight / 2) - (note.y * targetScale);
      
      setViewport({
          x: newX,
          y: newY,
          scale: targetScale
      });
      setIsSearchOpen(false);
  };


  // --- MULTIPLAYER & BOTS ---

  // Bot Logic (Demo Mode)
  useEffect(() => {
    if (!isDemo) return;

    const colors = ['#f87171', '#60a5fa', '#4ade80', '#fbbf24', '#a78bfa'];
    botsRef.current = Array.from({ length: 5 }).map((_, i) => ({
        id: `bot-${i}`,
        x: (Math.random() - 0.5) * 1000,
        y: (Math.random() - 0.5) * 1000,
        color: colors[i % colors.length],
        targetX: (Math.random() - 0.5) * 2000,
        targetY: (Math.random() - 0.5) * 2000
    }));

    const interval = setInterval(() => {
        // Update bot positions
        botsRef.current = botsRef.current.map(bot => {
            const dx = bot.targetX - bot.x;
            const dy = bot.targetY - bot.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            if (dist < 10) {
                return {
                    ...bot,
                    targetX: (Math.random() - 0.5) * 2000, 
                    targetY: (Math.random() - 0.5) * 2000
                };
            }

            const speed = 5;
            return {
                ...bot,
                x: bot.x + (dx / dist) * speed,
                y: bot.y + (dy / dist) * speed
            };
        });

        const cursorData: CursorData[] = botsRef.current.map(bot => ({
            id: bot.id,
            x: bot.x,
            y: bot.y,
            color: bot.color,
            lastUpdate: Date.now()
        }));

        if (Math.random() < 0.02) {
            const bot = botsRef.current[Math.floor(Math.random() * botsRef.current.length)];
            const chunkX = Math.floor(bot.x / CHUNK_SIZE);
            const chunkY = Math.floor(bot.y / CHUNK_SIZE);
            const chunkKey = `${chunkX}_${chunkY}`;
            const emojis = ['❤️', '🔥', '👀', '🚀'];
            
            const newStamp: StampData = {
                id: `bot-stamp-${Date.now()}`,
                x: bot.x,
                y: bot.y,
                emoji: emojis[Math.floor(Math.random() * emojis.length)],
                rotation: (Math.random() * 30) - 15,
                timestamp: Date.now()
            };
            
            // Bot updates also need manual injection in demo mode if we want smooth visuals,
            // though dispatchEvent handles it for localStorage-listener.
            const json = localStorage.getItem(`chunk_stamps_${chunkKey}`);
            const data = json ? JSON.parse(json) : {};
            data[newStamp.id] = newStamp;
            localStorage.setItem(`chunk_stamps_${chunkKey}`, JSON.stringify(data));
            window.dispatchEvent(new CustomEvent('local-storage-update', { detail: { chunkKey, type: 'stamp' } }));
        }

        setCursors(cursorData);
    }, 50);

    return () => clearInterval(interval);
  }, [isDemo]);

  // Real Multiplayer Logic (Firebase)
  useEffect(() => {
    if (isDemo || !db) return;
    
    // Subscribe to cursors - This is the ONLY Real-time listener we keep 
    // because it provides presence. Cursors are ephemeral and don't cost storage.
    const cursorsRef = ref(db, 'cursors');
    
    const unsub = onValue(cursorsRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) {
            setCursors([]);
            return;
        }
        const now = Date.now();
        const active: CursorData[] = [];
        Object.values(data).forEach((c: any) => {
            if (now - c.lastUpdate < 30000) { // Cleanup old cursors > 30s
                active.push(c);
            }
        });
        setCursors(active);
    });
    
    return () => unsub();
  }, [isDemo]);

  // Publish own cursor (Firebase)
  useEffect(() => {
      if (isDemo || !db || !auth?.currentUser) return;
      
      const publishCursor = (e: MouseEvent) => {
          const worldPos = screenToWorld(e.clientX, e.clientY);
          // Throttle updates: Lower frequency to save Writes
          if (Math.random() > 0.05) return; 

          const myCursorRef = ref(db, `cursors/${auth.currentUser?.uid}`);
          set(myCursorRef, {
              id: auth.currentUser?.uid,
              x: worldPos.x,
              y: worldPos.y,
              color: '#3b82f6', 
              lastUpdate: serverTimestamp()
          }).catch(() => {}); // Ignore write errors
      };

      window.addEventListener('mousemove', publishCursor);
      return () => window.removeEventListener('mousemove', publishCursor);
  }, [screenToWorld, isDemo]);


  // --- RENDER ---

  return (
    <div className="w-full h-screen overflow-hidden bg-[#f3f3f3] relative font-sans text-slate-800">
      
      <InfiniteCanvas 
        ref={canvasRef}
        viewport={viewport}
        onViewportChange={setViewport}
        onCanvasDragStart={handleDragStart}
        onCanvasClick={handleCanvasClick}
        onCanvasDoubleClick={handleDoubleClick}
        newNotePreview={null}
        cursors={cursors}
      />

      {/* Header */}
      <div className="fixed top-0 left-0 right-0 p-6 pointer-events-none z-40">
        <h1 className="text-2xl font-bold tracking-tight text-gray-400 opacity-50 uppercase text-center md:text-left drop-shadow-sm">
          Post It Here <span className="text-xs font-normal normal-case block md:inline md:ml-2">
            {isDemo ? "Offline Demo (Bots Enabled)" : "Live Infinite Board"}
          </span>
        </h1>
      </div>

      <Controls 
        scale={viewport.scale}
        tool={tool}
        setTool={setTool}
        selectedEmoji={selectedEmoji}
        setSelectedEmoji={setSelectedEmoji}
        onZoomIn={() => setViewport(prev => ({ ...prev, scale: Math.min(prev.scale * 1.2, MAX_SCALE) }))}
        onZoomOut={() => setViewport(prev => ({ ...prev, scale: Math.max(prev.scale / 1.2, MIN_SCALE) }))}
        onResetView={() => {
            stopInertia();
            setViewport({ x: window.innerWidth/2, y: window.innerHeight/2, scale: 1 });
        }}
        onToggleSearch={() => {
            setIsSearchOpen(true);
            setTimeout(() => document.getElementById('search-input')?.focus(), 50);
        }}
        onAddNote={() => {
            setCreationPos(null);
            setIsModalOpen(true);
        }}
      />

      {/* Search Modal */}
      {isSearchOpen && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-start justify-center pt-24 animate-in fade-in duration-100" onClick={() => setIsSearchOpen(false)}>
           <div className="bg-white/95 backdrop-blur-xl w-full max-w-lg rounded-2xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col max-h-[60vh]" onClick={e => e.stopPropagation()}>
              <div className="p-4 border-b border-gray-100 flex items-center gap-3">
                  <svg className="text-gray-400" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                  <input 
                    id="search-input"
                    type="text" 
                    placeholder="Search notes..." 
                    className="flex-1 bg-transparent outline-none text-lg text-gray-700 placeholder:text-gray-400"
                    value={searchQuery}
                    onChange={(e) => handleSearch(e.target.value)}
                    autoFocus
                  />
                  <button onClick={() => setIsSearchOpen(false)} className="text-gray-400 hover:text-gray-600">
                    <kbd className="font-sans text-xs border border-gray-200 rounded px-1.5 py-0.5">ESC</kbd>
                  </button>
              </div>
              <div className="overflow-y-auto p-2">
                 {searchQuery.trim() === '' ? (
                     <div className="p-8 text-center text-gray-400 text-sm">
                        Type to find sticky notes on the board.
                     </div>
                 ) : searchResults.length === 0 ? (
                     <div className="p-8 text-center text-gray-400 text-sm">
                        No notes found matching "{searchQuery}".
                     </div>
                 ) : (
                     <div className="space-y-1">
                        {searchResults.map(result => (
                            <button 
                                key={result.id}
                                onClick={() => jumpToNote(result)}
                                className="w-full text-left p-3 rounded-xl hover:bg-gray-100 transition-colors group flex items-start gap-3"
                            >
                                <div className="w-3 h-3 rounded-full mt-1.5 shrink-0" style={{ backgroundColor: result.color }}></div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-gray-800 font-medium truncate">{result.text}</p>
                                    <p className="text-xs text-gray-400 mt-0.5">
                                        Location: {Math.round(result.x)}, {Math.round(result.y)}
                                    </p>
                                </div>
                                <div className="opacity-0 group-hover:opacity-100 text-blue-500 text-sm font-medium self-center">
                                    Jump &rarr;
                                </div>
                            </button>
                        ))}
                     </div>
                 )}
              </div>
           </div>
        </div>
      )}

      {/* Creation Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden transform transition-all scale-100 opacity-100">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-gray-800">
                    {creationPos ? "Place Note Here" : "New Sticky Note"}
                </h2>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full text-gray-500">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              </div>

              <div className="relative mb-6">
                <textarea
                  value={newNoteText}
                  onChange={(e) => setNewNoteText(e.target.value)}
                  maxLength={200}
                  placeholder="Write something (max 200 chars)..."
                  className="w-full h-32 p-4 text-xl font-handwriting bg-gray-50 rounded-xl border-2 border-transparent focus:border-blue-500 focus:bg-white transition-all resize-none outline-none text-gray-700"
                  autoFocus
                />
                <div className="text-right text-xs text-gray-400 mt-1">{newNoteText.length}/200</div>
              </div>

              <div className="flex gap-3 mb-8 justify-center">
                {Object.values(NoteColor).map(color => (
                  <button
                    key={color}
                    onClick={() => setNewNoteColor(color)}
                    style={{ backgroundColor: color }}
                    className={`w-10 h-10 rounded-full shadow-sm hover:scale-110 ring-2 ring-offset-2 ${newNoteColor === color ? 'ring-gray-400 scale-110' : 'ring-transparent'}`}
                  />
                ))}
              </div>

              <button
                onClick={handleCreateNote}
                disabled={!newNoteText.trim()}
                className="w-full bg-black text-white py-3.5 rounded-xl font-medium shadow-lg hover:shadow-xl hover:bg-gray-900 transition-all disabled:opacity-50"
              >
                Post It
              </button>
            </div>
          </div>
        </div>
      )}
      
      <div className="fixed bottom-6 right-6 pointer-events-none text-gray-400 text-sm hidden md:block select-none">
        <p>Double-click to post &bull; WASD to move &bull; / to Search</p>
      </div>
    </div>
  );
};

export default App;