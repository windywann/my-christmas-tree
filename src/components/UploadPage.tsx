import { useCallback, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import './UploadPage.css';

export type UploadedImage = {
  id: string;
  file: File;
  url: string;
};

const SUPPORTED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const isImageFile = (f: File) => f.type.startsWith('image/');
const isSupportedImage = (f: File) => SUPPORTED_MIMES.includes(f.type);

function takeAtMost<T>(arr: T[], max: number) {
  return arr.length > max ? arr.slice(0, max) : arr;
}

export function UploadPage(props: {
  maxUploads: number;
  images: UploadedImage[];
  isProcessing: boolean;
  canStart: boolean;
  fallbackNotice?: string | null;
  onAddFiles: (files: File[]) => Promise<void>;
  onRemove: (id: string) => void;
  onClear: () => void;
  onStart: () => void;
  onStartEmpty: () => void;
}) {
  const {
    maxUploads,
    images,
    isProcessing,
    canStart,
    fallbackNotice,
    onAddFiles,
    onRemove,
    onClear,
    onStart,
    onStartEmpty
  } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const remaining = Math.max(0, maxUploads - images.length);

  const hint = useMemo(() => {
    if (images.length === 0) return `最多上传 ${maxUploads} 张照片（少于 ${maxUploads} 张会自动循环重复展示）`;
    if (images.length < maxUploads) return `已上传 ${images.length}/${maxUploads}（少于 ${maxUploads} 张会自动循环重复展示）`;
    return `已上传 ${images.length}/${maxUploads}`;
  }, [images.length, maxUploads]);

  const pick = useCallback(() => inputRef.current?.click(), []);

  const addFiles = useCallback(
    async (files: File[]) => {
      setError(null);
      const validImages = files.filter(isImageFile);
      if (validImages.length === 0) {
        setError('请选择图片文件（仅支持 jpg/png/webp/gif）');
        return;
      }
      const supported = validImages.filter(isSupportedImage);
      if (supported.length === 0) {
        setError('当前仅支持 jpg/png/webp/gif，HEIC/HEIF 请先转换格式');
        return;
      }
      if (remaining <= 0) {
        setError(`最多只能上传 ${maxUploads} 张照片`);
        return;
      }
      const accepted = takeAtMost(supported, remaining);
      if (accepted.length < validImages.length) setError(`最多 ${maxUploads} 张，已自动截取前 ${accepted.length} 张加入`);
      await onAddFiles(accepted);
    },
    [maxUploads, onAddFiles, remaining]
  );

  const onInputChange = useCallback(async () => {
    const files = Array.from(inputRef.current?.files ?? []);
    if (files.length > 0) await addFiles(files);
    if (inputRef.current) inputRef.current.value = '';
  }, [addFiles]);

  const onDrop = useCallback(
    async (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      await addFiles(Array.from(e.dataTransfer.files ?? []));
    },
    [addFiles]
  );

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return (
    <div className="uploadRoot">
      <div className="uploadTopBar">
        <div className="uploadBrand">
          <div className="uploadTitle">UPLOAD MEMORIES</div>
          <div className="uploadSubtitle">Create Your Exclusive Christmas Tree</div>
        </div>
        <div className="uploadActions">
          <button className="btn btnGhost" onClick={onClear} disabled={images.length === 0 || isProcessing}>
            清空
          </button>
          <button className="btn btnGhost" onClick={onStartEmpty} disabled={isProcessing}>
            无照片直接体验
          </button>
          <button className="btn btnOutline" onClick={pick} disabled={remaining <= 0 || isProcessing}>
            选择照片
          </button>
          <button className="btn btnPrimary" onClick={onStart} disabled={!canStart || isProcessing}>
            {fallbackNotice ? '进入无照片模式' : '进入圣诞树'}
          </button>
        </div>
      </div>

      <div className="uploadContent">
        <div className="dropZone" onClick={pick} onDrop={onDrop} onDragOver={onDragOver} role="button" tabIndex={0}>
          <div className="dropZoneInner">
            <div className="dropZoneKicker">拖拽照片到这里</div>
            <div className="dropZoneHint">{isProcessing ? '正在处理图片...' : hint}</div>
            {error ? <div className="dropZoneError">{error}</div> : null}
            {fallbackNotice ? <div className="dropZoneError">{fallbackNotice}</div> : null}
          </div>
        </div>

        <div className="galleryHeader">
          <div className="galleryMeta">
            <span className="badge">{images.length}</span>
            <span className="galleryText">已选择</span>
            <span className="galleryDim">（最多 {maxUploads}）</span>
          </div>
          <div className="galleryDim">{isProcessing ? '图片处理中，请稍候...' : ''}</div>
        </div>

        <div className="grid">
          {images.map((img) => (
            <div className="cell" key={img.id}>
              <img className="thumb" src={img.url} alt={img.file.name} />
              <button className="remove" onClick={() => onRemove(img.id)} aria-label="移除">
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      <input
        ref={inputRef}
        className="hiddenInput"
        type="file"
        accept="image/*"
        multiple
        onChange={onInputChange}
      />
    </div>
  );
}


