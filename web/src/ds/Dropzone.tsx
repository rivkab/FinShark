import { useRef, useState, type ReactNode } from "react";
import { Button } from "./Button.tsx";
import { Icon } from "./icons.tsx";
import "./Dropzone.css";

export interface DropzoneProps {
  onFiles: (files: File[]) => void;
  accept: string;
  multiple?: boolean | undefined;
  prompt: ReactNode;
  buttonLabel: string;
}

export function Dropzone({ onFiles, accept, multiple, prompt, buttonLabel }: DropzoneProps) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      className={over ? "ds-dropzone ds-dropzone--over" : "ds-dropzone"}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <Icon name="upload" size={24} />
      <p>{prompt}</p>
      <Button onClick={() => input.current?.click()}>{buttonLabel}</Button>
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </div>
  );
}
