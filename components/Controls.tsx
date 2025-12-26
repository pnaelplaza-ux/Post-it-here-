import React from 'react';
import { ToolMode } from '../types';

interface ControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onAddNote: () => void;
  onResetView: () => void;
  onToggleSearch: () => void;
  scale: number;
  tool: ToolMode;
  setTool: (t: ToolMode) => void;
  selectedEmoji: string;
  setSelectedEmoji: (e: string) => void;
}

const EMOJIS = ['❤️', '🔥', '😂', '🚀', '⭐', '💀', '👀', '👍'];

const Controls: React.FC<ControlsProps> = ({ 
    onZoomIn, 
    onZoomOut, 
    onAddNote, 
    onResetView, 
    onToggleSearch,
    scale,
    tool,
    setTool,
    selectedEmoji,
    setSelectedEmoji
}) => {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-4 z-50 pointer-events-none">
      
      {/* Tool Switcher */}
      <div className="flex items-center gap-2 pointer-events-auto bg-white/90 backdrop-blur-md shadow-xl rounded-full p-1 border border-gray-100">
        <button
            onClick={() => setTool('pan')}
            className={`px-4 py-2 rounded-full font-medium text-sm transition-all flex items-center gap-2 ${tool === 'pan' ? 'bg-black text-white shadow-md' : 'text-gray-500 hover:bg-gray-100'}`}
        >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
            Select/Move
        </button>
        
        <button
            onClick={() => setTool('link')}
            className={`px-4 py-2 rounded-full font-medium text-sm transition-all flex items-center gap-2 ${tool === 'link' ? 'bg-blue-500 text-white shadow-md' : 'text-gray-500 hover:bg-gray-100'}`}
        >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="3"></circle><line x1="12" y1="22" x2="12" y2="8"></line></svg>
            Link
        </button>

        <button
            onClick={() => setTool('stamp')}
            className={`px-4 py-2 rounded-full font-medium text-sm transition-all flex items-center gap-2 ${tool === 'stamp' ? 'bg-rose-500 text-white shadow-md' : 'text-gray-500 hover:bg-gray-100'}`}
        >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"></path><line x1="16" y1="8" x2="2" y2="22"></line><line x1="17.5" y1="15" x2="9" y2="15"></line></svg>
            Stamp
        </button>
      </div>

      {/* Stamp Picker (Only visible if stamp tool active) */}
      {tool === 'stamp' && (
          <div className="pointer-events-auto bg-white/90 backdrop-blur-md shadow-xl rounded-2xl p-2 flex gap-1 border border-gray-100 animate-in slide-in-from-bottom-2">
              {EMOJIS.map(emoji => (
                  <button
                    key={emoji}
                    onClick={() => setSelectedEmoji(emoji)}
                    className={`w-10 h-10 flex items-center justify-center text-xl rounded-xl hover:bg-gray-100 transition-all ${selectedEmoji === emoji ? 'bg-rose-100 scale-110' : ''}`}
                  >
                      {emoji}
                  </button>
              ))}
          </div>
      )}

      {/* Navigation Bar */}
      <div className="bg-white/90 backdrop-blur-md shadow-xl rounded-2xl p-2 flex items-center gap-2 pointer-events-auto border border-gray-100">
        
        <button
          onClick={onZoomOut}
          className="p-3 hover:bg-gray-100 rounded-xl transition-colors text-gray-600 active:scale-95"
          title="Zoom Out"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>
        </button>

        <span className="w-16 text-center text-sm font-medium text-gray-500 select-none">
          {Math.round(scale * 100)}%
        </span>

        <button
          onClick={onZoomIn}
          className="p-3 hover:bg-gray-100 rounded-xl transition-colors text-gray-600 active:scale-95"
          title="Zoom In"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>
        </button>

        <div className="w-px h-8 bg-gray-200 mx-2"></div>

        <button
          onClick={onToggleSearch}
          className="p-3 hover:bg-gray-100 rounded-xl transition-colors text-gray-600 active:scale-95"
          title="Search Notes"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        </button>

        <button
          onClick={onResetView}
           className="p-3 hover:bg-gray-100 rounded-xl transition-colors text-gray-600 active:scale-95"
           title="Center View"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
        </button>

        <div className="w-px h-8 bg-gray-200 mx-2"></div>

        <button
            onClick={onAddNote}
            className="bg-black text-white hover:bg-gray-800 transition-all shadow-md hover:shadow-lg rounded-xl p-3 flex items-center gap-2 active:scale-95"
            title="Add Note (or Double Click)"
        >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
        </button>

      </div>
    </div>
  );
};

export default Controls;
