import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { autoWindow, bakeMono, viewStride, type DicomFrame, type DicomImage } from './dicom-decode';

type Tool = 'pan' | 'zoom' | 'wl';
interface ViewState {
  zoom: number;
  panX: number;
  panY: number;
  rotate: number;
  flip: boolean;
  invert: boolean;
}
const INITIAL_VIEW: ViewState = { zoom: 1, panX: 0, panY: 0, rotate: 0, flip: false, invert: false };

function invertRgba(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < rgba.length; i += 4) {
    out[i] = 255 - rgba[i]!;
    out[i + 1] = 255 - rgba[i + 1]!;
    out[i + 2] = 255 - rgba[i + 2]!;
    out[i + 3] = 255;
  }
  return out;
}

function ToolButton({ label, on, disabled, onClick }: { label: string; on?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on === undefined ? undefined : on}
      className={`rounded-md border px-2.5 py-1 text-[12.5px] font-semibold transition-colors disabled:opacity-40 ${
        on ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-700 bg-[#131c30] text-slate-300 hover:bg-[#1b2740]'
      }`}
    >
      {label}
    </button>
  );
}

/**
 * Vùng xem ảnh DICOM (docs/DECISIONS.md #299 bổ sung 6, mockup B4): thanh công cụ (Kéo, Phóng, Sáng/tương phản, Đảo màu, Xoay, Lật, Đặt lại), ảnh vẽ trên canvas, bốn góc ghi thông tin lấy TỪ TỆP
 * (để người xem tự đối chiếu), thanh chọn khung khi tệp có nhiều khung. Cuộn chuột = phóng/thu; ↑ ↓ đổi khung. Ảnh rất lớn được thu nhỏ khi vẽ (bản tải về vẫn là bản gốc).
 */
export function DicomStage({ image }: { image: DicomImage }) {
  const { info } = image;
  const [frameIndex, setFrameIndex] = useState(0);
  const [frame, setFrame] = useState<DicomFrame | null>(null);
  const [frameFailed, setFrameFailed] = useState(false);
  const [win, setWin] = useState<{ center: number; width: number } | null>(image.tagWindow);
  const [view, setView] = useState<ViewState>(INITIAL_VIEW);
  const [tool, setTool] = useState<Tool>('pan');
  const [bakeVersion, setBakeVersion] = useState(0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreen = useRef<HTMLCanvasElement | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const stride = useMemo(() => viewStride(info.rows, info.cols), [info.rows, info.cols]);
  const mono = frame?.kind === 'mono';

  // Nạp khung đang chọn; khung đơn sắc đầu tiên mà tệp không ghi cửa sổ thì tính cửa sổ tự động.
  useEffect(() => {
    let alive = true;
    setFrameFailed(false);
    image
      .getFrame(frameIndex)
      .then((f) => {
        if (!alive) return;
        setFrame(f);
        if (f.kind === 'mono') setWin((w) => w ?? autoWindow(f.raw, image.slope, image.intercept));
      })
      .catch(() => alive && setFrameFailed(true));
    return () => {
      alive = false;
    };
  }, [image, frameIndex]);

  // Vẽ khung ra canvas ẩn theo cửa sổ + đảo màu (đây là phần nặng; kéo/phóng chỉ vẽ lại canvas hiển thị).
  useEffect(() => {
    if (!frame) return;
    let rgba: Uint8ClampedArray;
    let w: number;
    let h: number;
    if (frame.kind === 'mono') {
      if (!win) return;
      const invert = (image.photometric === 'MONOCHROME1') !== view.invert;
      const baked = bakeMono(frame.raw, info.rows, info.cols, { slope: image.slope, intercept: image.intercept, center: win.center, width: win.width, invert, stride });
      rgba = baked.rgba;
      w = baked.width;
      h = baked.height;
    } else {
      rgba = view.invert ? invertRgba(frame.rgba) : frame.rgba;
      w = frame.width;
      h = frame.height;
    }
    const canvas = (offscreen.current ??= document.createElement('canvas'));
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')?.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
    setBakeVersion((v) => v + 1);
  }, [frame, win, view.invert, image, info.rows, info.cols, stride]);

  // Kích thước vùng hiển thị.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Vẽ canvas hiển thị: vừa khung, rồi phóng/kéo/xoay/lật.
  useEffect(() => {
    const canvas = canvasRef.current;
    const off = offscreen.current;
    if (!canvas || !off || size.w === 0 || size.h === 0 || off.width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const turned = view.rotate % 180 !== 0;
    const fit = Math.min(canvas.width / (turned ? off.height : off.width), canvas.height / (turned ? off.width : off.height)) * 0.96;
    ctx.imageSmoothingEnabled = true;
    ctx.translate(canvas.width / 2 + view.panX * dpr, canvas.height / 2 + view.panY * dpr);
    ctx.rotate((view.rotate * Math.PI) / 180);
    ctx.scale(view.flip ? -1 : 1, 1);
    ctx.scale(fit * view.zoom, fit * view.zoom);
    ctx.drawImage(off, -off.width / 2, -off.height / 2);
  }, [bakeVersion, view, size]);

  const zoomBy = useCallback((factor: number) => setView((v) => ({ ...v, zoom: Math.max(0.3, Math.min(8, v.zoom * factor)) })), []);

  // Cuộn chuột = phóng/thu (cần bộ nghe không thụ động để chặn cuộn trang).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.1 : 0.9);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  // ↑ ↓ đổi khung.
  useEffect(() => {
    if (info.frameCount < 2) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFrameIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFrameIndex((i) => Math.min(info.frameCount - 1, i + 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [info.frameCount]);

  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    if (tool === 'pan') setView((v) => ({ ...v, panX: v.panX + dx, panY: v.panY + dy }));
    else if (tool === 'zoom') setView((v) => ({ ...v, zoom: Math.max(0.3, Math.min(8, v.zoom * (1 - dy * 0.01))) }));
    else if (mono) {
      setWin((w) => (w ? { center: w.center - dy * Math.max(w.width / 256, 0.01) * 2, width: Math.max(1, w.width + dx * Math.max(w.width / 256, 0.01) * 2) } : w));
    }
  }

  function reset() {
    setView(INITIAL_VIEW);
    if (frame?.kind === 'mono') setWin(image.tagWindow ?? autoWindow(frame.raw, image.slope, image.intercept));
  }

  const zoomPercent = Math.round(view.zoom * 100);
  const spacing = info.pixelSpacingMm !== null ? `${String(info.pixelSpacingMm).replace('.', ',')} mm/điểm ảnh` : null;
  const sexAge = [info.patientId, info.patientAge, info.patientSex].filter(Boolean).join(' · ');
  const what = [info.modality, info.bodyPart || info.seriesDescription].filter(Boolean).join(' · ');
  const when = [info.studyDate, info.studyTime].filter(Boolean).join(' ');

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-2.5 text-slate-200">
      <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Công cụ xem ảnh">
        <ToolButton label="Kéo" on={tool === 'pan'} onClick={() => setTool('pan')} />
        <ToolButton label="Phóng" on={tool === 'zoom'} onClick={() => setTool('zoom')} />
        <ToolButton label="Sáng, tương phản" on={tool === 'wl'} disabled={!mono} onClick={() => setTool('wl')} />
        <span className="mx-0.5 h-5 w-px bg-slate-700" aria-hidden="true" />
        <ToolButton label="Đảo màu" on={view.invert} onClick={() => setView((v) => ({ ...v, invert: !v.invert }))} />
        <ToolButton label="Xoay 90°" onClick={() => setView((v) => ({ ...v, rotate: (v.rotate + 90) % 360 }))} />
        <ToolButton label="Lật ngang" on={view.flip} onClick={() => setView((v) => ({ ...v, flip: !v.flip }))} />
        <ToolButton label="Đặt lại" onClick={reset} />
      </div>
      <div ref={wrapRef} className="relative min-h-[240px] flex-1 overflow-hidden rounded-md bg-black">
        <canvas
          ref={canvasRef}
          aria-label="Ảnh DICOM"
          role="img"
          className="absolute inset-0 h-full w-full cursor-grab touch-none active:cursor-grabbing"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, y: e.clientY };
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onPointerMove={onPointerMove}
        />
        {frameFailed && <div role="alert" className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm font-semibold text-rose-300">Không đọc được khung ảnh này.</div>}
        <div className="pointer-events-none absolute left-2.5 top-2 text-xs leading-snug text-amber-200 [text-shadow:0_1px_2px_#000]">
          {info.patientName && <div>{info.patientName}</div>}
          {sexAge && <div>{sexAge}</div>}
        </div>
        <div className="pointer-events-none absolute right-2.5 top-2 text-right text-xs leading-snug text-amber-200 [text-shadow:0_1px_2px_#000]">
          {what && <div>{what}</div>}
          {when && <div>{when}</div>}
        </div>
        <div className="pointer-events-none absolute bottom-2 left-2.5 text-xs leading-snug tabular-nums text-amber-200 [text-shadow:0_1px_2px_#000]">
          <div>Phóng {zoomPercent}%</div>
          {mono && win && (
            <div>
              W {Math.round(win.width)} · L {Math.round(win.center)}
            </div>
          )}
        </div>
        <div className="pointer-events-none absolute bottom-2 right-2.5 text-right text-xs leading-snug tabular-nums text-amber-200 [text-shadow:0_1px_2px_#000]">
          <div>
            {info.cols} × {info.rows}
          </div>
          {spacing && <div>{spacing}</div>}
        </div>
      </div>
      {info.frameCount > 1 && (
        <div className="flex items-center gap-2.5 text-xs font-medium text-slate-300">
          <span className="tabular-nums">
            Khung {frameIndex + 1}/{info.frameCount}
          </span>
          <input type="range" min={1} max={info.frameCount} value={frameIndex + 1} aria-label="Chọn khung" onChange={(e) => setFrameIndex(Number(e.target.value) - 1)} className="flex-1 accent-blue-600" />
        </div>
      )}
    </div>
  );
}
