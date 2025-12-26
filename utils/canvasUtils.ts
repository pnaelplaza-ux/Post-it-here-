import { NoteData, NoteColor, StampData, CursorData, LinkData } from '../types';

const TTL_WARNING_AGE_MS = 20 * 60 * 60 * 1000; // 20 Hours

// --- HIT TESTING ---
export const hitTestNote = (note: NoteData, x: number, y: number): boolean => {
  // Translate point to note local space to handle rotation
  const dx = x - note.x;
  const dy = y - note.y;
  
  // Inverse rotation
  const rad = (-note.rotation * Math.PI) / 180;
  const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
  const localY = dx * Math.sin(rad) + dy * Math.cos(rad);

  const size = 240;
  const half = size / 2;

  return localX >= -half && localX <= half && localY >= -half && localY <= half;
};

// --- LINKS ---
export const drawLink = (
  ctx: CanvasRenderingContext2D,
  source: NoteData,
  target: NoteData
) => {
  ctx.beginPath();
  ctx.moveTo(source.x, source.y);
  
  // Bezier curve for organic connection
  const midX = (source.x + target.x) / 2;
  const midY = (source.y + target.y) / 2;
  
  // Control point offset based on distance to create an arc
  const dist = Math.sqrt(Math.pow(target.x - source.x, 2) + Math.pow(target.y - source.y, 2));
  const offset = Math.min(dist * 0.2, 100);
  
  // Simple quadratic curve implies gravity/slack
  ctx.quadraticCurveTo(midX, midY + offset, target.x, target.y);
  
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.stroke();
};

// --- STAMPS ---
export const drawStamp = (
  ctx: CanvasRenderingContext2D,
  stamp: StampData
) => {
  ctx.save();
  ctx.translate(stamp.x, stamp.y);
  ctx.rotate((stamp.rotation * Math.PI) / 180);
  
  ctx.font = '40px "Inter", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  // Subtle shadow for depth
  ctx.shadowColor = 'rgba(0,0,0,0.1)';
  ctx.shadowBlur = 2;
  ctx.shadowOffsetY = 2;
  
  ctx.fillText(stamp.emoji, 0, 0);
  
  ctx.restore();
};

// --- CURSORS ---
export const drawCursor = (
  ctx: CanvasRenderingContext2D,
  cursor: CursorData
) => {
  ctx.save();
  ctx.translate(cursor.x, cursor.y);
  
  // Draw Arrow
  ctx.fillStyle = cursor.color;
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 2;
  
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(8, 24);
  ctx.lineTo(12, 18);
  ctx.lineTo(22, 28); // tail
  ctx.lineTo(26, 24); // tail width
  ctx.lineTo(16, 14);
  ctx.lineTo(24, 12);
  ctx.closePath();
  
  ctx.fill();
  ctx.stroke();

  // Draw Label (Optional ID)
  ctx.fillStyle = cursor.color;
  ctx.font = '10px sans-serif';
  ctx.fillText(cursor.id.slice(0, 6), 14, 30);

  ctx.restore();
};

// --- NOTES ---
export const drawNote = (
  ctx: CanvasRenderingContext2D,
  note: NoteData,
  isSelected: boolean
) => {
  const age = Date.now() - note.timestamp;
  const isExpiring = age > TTL_WARNING_AGE_MS;

  ctx.save();
  ctx.translate(note.x, note.y);
  ctx.rotate((note.rotation * Math.PI) / 180);

  // Apply fading for expiring notes (weathering effect)
  if (isExpiring) {
      ctx.globalAlpha = 0.85; 
  }

  // Shadow
  ctx.shadowColor = 'rgba(0,0,0,0.15)';
  ctx.shadowBlur = isSelected ? 25 : 6;
  ctx.shadowOffsetX = isSelected ? 8 : 2;
  ctx.shadowOffsetY = isSelected ? 15 : 4;

  // Note Body
  const size = 240;
  const half = size / 2;
  
  // If expiring, maybe desaturate slightly? 
  // For now, opacity is good enough.
  ctx.fillStyle = note.color;
  
  // Draw a slightly imperfect square for realism
  ctx.beginPath();
  ctx.moveTo(-half, -half);
  ctx.lineTo(half, -half);
  ctx.lineTo(half, half - 20); // Dog ear start
  ctx.lineTo(half - 20, half); // Dog ear end
  ctx.lineTo(-half, half);
  ctx.closePath();
  ctx.fill();

  // Dog Ear Visual
  ctx.fillStyle = 'rgba(0,0,0,0.1)'; // Fold shadow
  ctx.beginPath();
  ctx.moveTo(half, half - 20);
  ctx.lineTo(half, half);
  ctx.lineTo(half - 20, half);
  ctx.fill();
  
  ctx.fillStyle = 'rgba(255,255,255,0.3)'; // Fold highlight
  ctx.beginPath();
  ctx.moveTo(half, half - 20);
  ctx.lineTo(half - 20, half - 20);
  ctx.lineTo(half - 20, half);
  ctx.fill();

  // Selection outline
  if (isSelected) {
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 4;
      ctx.stroke();
  }

  // Reset shadow for text
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // Draw Expiration Warning Icon
  if (isExpiring) {
      ctx.font = '24px "Inter", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      // Draw hour glass emoji in top-left
      ctx.fillText('⌛', -half + 10, -half + 10);
  }

  // Text
  ctx.fillStyle = isExpiring ? '#4b5563' : '#1f2937'; // Slightly lighter text if expiring
  ctx.font = '30px "Caveat", cursive';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  wrapText(ctx, note.text, 0, -20, size - 40, 32);

  // Tape (optional)
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.translate(0, -half + 5);
  ctx.rotate(-0.02);
  ctx.fillRect(-40, -10, 80, 20);

  ctx.restore();
};

const wrapText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) => {
  const words = text.split(' ');
  let line = '';
  const lines: string[] = [];

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    const testWidth = metrics.width;
    
    if (testWidth > maxWidth && n > 0) {
      lines.push(line);
      line = words[n] + ' ';
    } else {
      line = testLine;
    }
  }
  lines.push(line);

  // Center vertically based on number of lines
  const totalHeight = lines.length * lineHeight;
  let currentY = y - (totalHeight / 2) + (lineHeight / 2);

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x, currentY);
    currentY += lineHeight;
  }
};
