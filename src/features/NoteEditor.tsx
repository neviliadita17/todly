import { useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import Image from "@tiptap/extension-image";
import {
  Bold, Heading1, Heading2, Heading3, Image as ImageIcon, Italic, List, ListChecks,
  ListOrdered, Redo2, Strikethrough, Table as TableIcon, Underline as UnderlineIcon, Undo2,
} from "lucide-react";
import type { ReactNode } from "react";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Catatan lama berupa teks biasa diubah ke HTML saat dibuka. */
const toHtml = (c: string) =>
  !c ? "" : c.trimStart().startsWith("<") ? c : c.split("\n").map((l) => `<p>${esc(l)}</p>`).join("");

const html = (e: Editor) => (e.isEmpty ? "" : e.getHTML());

const readAsDataUrl = (f: File) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("Gagal membaca gambar"));
    r.readAsDataURL(f);
  });

/** Gambar dikecilkan (maks. lebar 1280 px) agar database tidak membengkak. */
async function imageToDataUrl(file: File): Promise<string> {
  if (file.size > 20 * 1024 * 1024) throw new Error("Gambar terlalu besar (maks. 20 MB)");
  if (file.type === "image/gif" || file.type === "image/svg+xml") return readAsDataUrl(file);
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / bmp.width);
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  cv.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  return cv.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.85);
}

function Btn({ title, active, disabled, onClick, children }: {
  title: string; active?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode;
}) {
  return (
    <button type="button" title={title} disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // jangan merebut fokus dari editor
      onClick={onClick}
      className={`rounded-lg p-1.5 transition disabled:opacity-30 ${
        active ? "bg-brand/15 text-brand" : "text-slate-500 hover:bg-black/5 hover:text-brand"
      }`}>
      {children}
    </button>
  );
}

const Sep = () => <span className="mx-1 h-4 w-px bg-black/10" />;

interface Props {
  initial: string;
  autoFocus: boolean;
  onReady: (html: string) => void;
  onChange: (html: string) => void;
  onBlur: () => void;
}

export default function NoteEditor({ initial, autoFocus, onReady, onChange, onBlur }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const insertRef = useRef<(f: File) => void>(() => {});

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Image.configure({ allowBase64: true }),
    ],
    content: toHtml(initial),
    autofocus: autoFocus ? "end" : false,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: { class: "note-editor min-h-full px-8 py-4 text-[15px] leading-relaxed text-ink outline-none" },
      handlePaste: (_view, e) => {
        const f = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith("image/"));
        if (!f) return false;
        e.preventDefault();
        insertRef.current(f);
        return true;
      },
    },
    onCreate: ({ editor }) => onReady(html(editor)),
    onUpdate: ({ editor }) => onChange(html(editor)),
    onBlur: () => onBlur(),
  });

  insertRef.current = async (file: File) => {
    if (!editor) return;
    try {
      editor.chain().focus().setImage({ src: await imageToDataUrl(file) }).run();
    } catch (e) {
      alert(String(e instanceof Error ? e.message : e));
    }
  };

  if (!editor) return null;
  const c = () => editor.chain().focus();

  return (
    <>
      <div className="flex flex-wrap items-center gap-0.5 border-y border-black/5 bg-white/60 px-4 py-1.5">
        <Btn title="Urungkan (Ctrl+Z)" disabled={!editor.can().undo()} onClick={() => c().undo().run()}><Undo2 size={16} /></Btn>
        <Btn title="Ulangi (Ctrl+Y)" disabled={!editor.can().redo()} onClick={() => c().redo().run()}><Redo2 size={16} /></Btn>
        <Sep />
        <Btn title="Judul 1" active={editor.isActive("heading", { level: 1 })} onClick={() => c().toggleHeading({ level: 1 }).run()}><Heading1 size={16} /></Btn>
        <Btn title="Judul 2" active={editor.isActive("heading", { level: 2 })} onClick={() => c().toggleHeading({ level: 2 }).run()}><Heading2 size={16} /></Btn>
        <Btn title="Judul 3" active={editor.isActive("heading", { level: 3 })} onClick={() => c().toggleHeading({ level: 3 }).run()}><Heading3 size={16} /></Btn>
        <Sep />
        <Btn title="Tebal (Ctrl+B)" active={editor.isActive("bold")} onClick={() => c().toggleBold().run()}><Bold size={16} /></Btn>
        <Btn title="Miring (Ctrl+I)" active={editor.isActive("italic")} onClick={() => c().toggleItalic().run()}><Italic size={16} /></Btn>
        <Btn title="Garis bawah (Ctrl+U)" active={editor.isActive("underline")} onClick={() => c().toggleUnderline().run()}><UnderlineIcon size={16} /></Btn>
        <Btn title="Coret" active={editor.isActive("strike")} onClick={() => c().toggleStrike().run()}><Strikethrough size={16} /></Btn>
        <Sep />
        <Btn title="Bullet list" active={editor.isActive("bulletList")} onClick={() => c().toggleBulletList().run()}><List size={16} /></Btn>
        <Btn title="Daftar bernomor" active={editor.isActive("orderedList")} onClick={() => c().toggleOrderedList().run()}><ListOrdered size={16} /></Btn>
        <Btn title="Daftar centang" active={editor.isActive("taskList")} onClick={() => c().toggleTaskList().run()}><ListChecks size={16} /></Btn>
        <Sep />
        <Btn title="Sisipkan tabel" active={editor.isActive("table")}
          onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><TableIcon size={16} /></Btn>
        <Btn title="Sisipkan gambar" onClick={() => fileRef.current?.click()}><ImageIcon size={16} /></Btn>
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) insertRef.current(f);
          }} />

        {editor.isActive("table") && (
          <span className="ml-2 flex flex-wrap items-center gap-1 text-[11px]">
            {([
              ["+ Baris", () => c().addRowAfter().run()],
              ["− Baris", () => c().deleteRow().run()],
              ["+ Kolom", () => c().addColumnAfter().run()],
              ["− Kolom", () => c().deleteColumn().run()],
              ["Hapus tabel", () => c().deleteTable().run()],
            ] as [string, () => void][]).map(([l, fn]) => (
              <button key={l} type="button" onMouseDown={(e) => e.preventDefault()} onClick={fn}
                className={`rounded-md px-2 py-1 hover:bg-black/5 ${l === "Hapus tabel" ? "text-red-500" : "text-slate-600"}`}>
                {l}
              </button>
            ))}
          </span>
        )}
      </div>

      <div className="flex-1 cursor-text overflow-y-auto"
        onClick={(e) => { if (e.target === e.currentTarget) editor.commands.focus("end"); }}>
        <EditorContent editor={editor} />
      </div>
    </>
  );
}