import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LiquidGlass } from './vendor/index.js';

/** The glass samples only this card's own iframe background. */
export function GlassSurface({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [effect, setEffect] = useState('static');
  useEffect(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let stopped = false;
    let generation = 0;
    let instance: LiquidGlass | undefined;
    let disposePending = () => {};
    const update = async () => {
      generation++;
      instance?.destroy();
      instance = undefined;
      disposePending();
      disposePending = () => {};
      const current = generation;
      setEffect('static');
      if (motion.matches || !root.current || !panel.current) return;
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('webgl');
      if (!context) return;
      context.getExtension('WEBGL_lose_context')?.loseContext();
      const container = root.current;
      const glass = panel.current;
      const { LiquidGlass } = await import('./vendor/index.js');
      if (stopped || current !== generation) return;
      const existingBody = new Set(document.body.children);
      const existingPanel = new Set(glass.children);
      const pending = LiquidGlass.init({
        root: container,
        glassElements: [glass],
        defaults: {
          blurAmount: 0.15,
          refraction: 0.24,
          chromAberration: 0.015,
          cornerRadius: 16,
          zRadius: 12,
          floating: false,
          shadowOpacity: 0.15,
        },
      });
      // init creates canvases synchronously, before font/image promises can stall.
      const ownedBody = Array.from(document.body.children).filter(
        (node): node is HTMLCanvasElement =>
          node instanceof HTMLCanvasElement && !existingBody.has(node),
      );
      const ownedPanel = Array.from(glass.children).filter(
        (node): node is HTMLCanvasElement =>
          node instanceof HTMLCanvasElement && !existingPanel.has(node),
      );
      let disposed = false;
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        for (const node of ownedBody) {
          node.getContext('webgl')?.getExtension('WEBGL_lose_context')?.loseContext();
          node.remove();
        }
        for (const node of ownedPanel) node.remove();
      };
      disposePending = dispose;
      try {
        const ready = await pending;
        if (stopped || current !== generation) {
          ready.destroy();
          dispose();
        } else {
          instance = ready;
          setEffect('webgl');
        }
      } catch {
        dispose();
        if (current === generation) {
          container.style.removeProperty('user-select');
          container.style.removeProperty('-webkit-user-select');
        }
      }
    };
    const start = () => {
      void update().catch(() => {
        if (!stopped) setEffect('static');
      });
    };
    start();
    motion.addEventListener('change', start);
    return () => {
      stopped = true;
      generation++;
      motion.removeEventListener('change', start);
      instance?.destroy();
      disposePending();
    };
  }, []);
  return (
    <div className="fuse-glass-root" data-glass-effect={effect}>
      {/* Keep source, images and controls outside the library's capture tree. */}
      <div ref={root} className="fuse-glass-backdrop" aria-hidden="true">
        <div className="fuse-glass-ambient" />
        <div ref={panel} className="fuse-glass-panel" />
      </div>
      {children}
    </div>
  );
}
