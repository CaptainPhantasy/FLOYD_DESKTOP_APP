/**
 * FileInput — attach photos, videos, files, and whole folders to a chat message.
 * Ported from the canonical FloydDesktopWeb-v2 desktop, with folder upload added.
 */
import { useRef } from 'react';
import { Paperclip, FolderUp, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FileAttachment {
  id: string;
  file: File;
  preview?: string;
  type: 'image' | 'video' | 'document' | 'code' | 'data';
}

const SUPPORTED_FILE_TYPES = {
  image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.tiff', '.tif'],
  video: ['.mp4', '.mov', '.webm', '.avi'],
  document: ['.pdf', '.docx', '.doc', '.txt', '.md'],
  code: ['.js', '.ts', '.tsx', '.jsx', '.py', '.java', '.c', '.cpp', '.cs', '.go', '.rb', '.php', '.html', '.css', '.json', '.xml', '.yaml', '.yml'],
  data: ['.json', '.csv', '.xml', '.yaml', '.yml'],
};

const getFileType = (file: File): FileAttachment['type'] => {
  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  if (SUPPORTED_FILE_TYPES.image.includes(ext)) return 'image';
  if (SUPPORTED_FILE_TYPES.video.includes(ext)) return 'video';
  if (SUPPORTED_FILE_TYPES.document.includes(ext)) return 'document';
  if (SUPPORTED_FILE_TYPES.data.includes(ext)) return 'data';
  if (SUPPORTED_FILE_TYPES.code.includes(ext)) return 'code';
  return 'document';
};

interface FileInputProps {
  attachments: FileAttachment[];
  onAttachmentsChange: (attachments: FileAttachment[]) => void;
  disabled?: boolean;
  /** Render only the attachment chips (no buttons). Used for the preview strip. */
  chipsOnly?: boolean;
}

export function FileInput({ attachments, onAttachmentsChange, disabled, chipsOnly }: FileInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const newAttachments: FileAttachment[] = [];

    await Promise.all(Array.from(files).map(async (file, i) => {
      const type = getFileType(file);
      const attachment: FileAttachment = {
        id: `${Date.now()}-${i}-${file.name}`,
        file,
        type,
      };

      if (type === 'image') {
        try {
          attachment.preview = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target?.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          });
        } catch {
          console.error('Failed to generate preview for', file.name);
        }
      }

      newAttachments.push(attachment);
    }));

    onAttachmentsChange([...attachments, ...newAttachments]);

    if (fileInputRef.current) fileInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  };

  const handleRemove = (id: string) => {
    onAttachmentsChange(attachments.filter((a) => a.id !== id));
  };

  const chips = attachments.length > 0 && (
    <div className="flex flex-wrap gap-2 mt-2">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="flex items-center gap-2 px-3 py-1.5 bg-slate-700 rounded-lg text-sm"
        >
          {attachment.preview && (
            <img
              src={attachment.preview}
              alt={attachment.file.name}
              className="w-6 h-6 object-cover rounded"
            />
          )}
          <span className="text-slate-300 max-w-[200px] truncate">
            {(attachment.file as File & { webkitRelativePath?: string }).webkitRelativePath || attachment.file.name}
          </span>
          <button
            type="button"
            onClick={() => handleRemove(attachment.id)}
            className="text-slate-400 hover:text-red-400 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );

  if (chipsOnly) return <div>{chips}</div>;

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*,.pdf,.doc,.docx,.txt,.md,.js,.ts,.tsx,.jsx,.py,.java,.c,.cpp,.cs,.go,.rb,.php,.html,.css,.json,.xml,.yaml,.yml,.csv"
        onChange={(e) => handleFileSelect(e.target.files)}
        className="hidden"
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // @ts-expect-error webkitdirectory is a non-standard but widely supported attribute
        webkitdirectory=""
        onChange={(e) => handleFileSelect(e.target.files)}
        className="hidden"
      />

      <div className="flex items-center">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className={cn(
            'p-2 rounded-lg transition-colors',
            'hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed',
            'text-slate-400 hover:text-slate-200',
          )}
          title="Attach files (photos, videos, documents, code)"
        >
          <Paperclip className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={() => folderInputRef.current?.click()}
          disabled={disabled}
          className={cn(
            'p-2 rounded-lg transition-colors',
            'hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed',
            'text-slate-400 hover:text-slate-200',
          )}
          title="Attach a folder"
        >
          <FolderUp className="w-5 h-5" />
        </button>
      </div>

      {chips}
    </div>
  );
}
