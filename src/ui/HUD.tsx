import { useEffect, useState } from 'react';
import { playerState } from '../player/Player';

const overlay: React.CSSProperties = {
  position: 'fixed',
  left: 16,
  bottom: 16,
  color: '#eaf6ff',
  background: 'rgba(8, 24, 38, 0.62)',
  border: '1px solid rgba(140, 200, 235, 0.25)',
  borderRadius: 10,
  padding: '12px 16px',
  fontSize: 13,
  lineHeight: 1.7,
  pointerEvents: 'none',
  backdropFilter: 'blur(6px)',
  maxWidth: 320,
};

const badge: React.CSSProperties = {
  position: 'fixed',
  top: 14,
  right: 16,
  color: '#d8efff',
  background: 'rgba(8, 24, 38, 0.55)',
  borderRadius: 8,
  padding: '6px 12px',
  fontSize: 12,
  pointerEvents: 'none',
  fontVariantNumeric: 'tabular-nums',
};

export function HUD() {
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 400);
    return () => clearInterval(id);
  }, []);

  const p = playerState.pos;
  return (
    <>
      <div style={overlay}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>孤岛漫游 · Island Walk</div>
        <div>点击画面锁定鼠标 · Esc 释放</div>
        <div>
          <b>WASD</b> 移动 · <b>Shift</b> 疾跑 · <b>Space</b> 跳跃 · <b>R</b> 回出生点
        </div>
        <div style={{ opacity: 0.75, marginTop: 4 }}>
          走进海里会自动游泳,游回浅滩即可上岸
        </div>
      </div>
      <div style={badge}>
        {playerState.fps} FPS · x {p.x.toFixed(1)} z {p.z.toFixed(1)}
        {playerState.swimming ? ' · 游泳中' : ''}
      </div>
    </>
  );
}
