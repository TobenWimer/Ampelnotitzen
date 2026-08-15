export type FolderColor =
  | "blue"
  | "teal"
  | "green"
  | "yellow"
  | "orange"
  | "red"
  | "pink"
  | "purple"
  | "gray";

export type Folder = {
  id: string;
  name: string;
  slug: string;
  color?: FolderColor;
  createdAtClient?: number;
};

// "canvas" = gezeichnetes Dokument (Editor unter doc/[id]), "file" = hochgeladene Datei.
// Fehlt docKind (alte Dokumente vor diesem Feature), gilt es als "canvas".
export type DocKind = "canvas" | "file";

export type DocItem = {
  id: string;
  name: string;
  color?: FolderColor;
  createdAtClient: number;
  docKind?: DocKind;
  storagePath?: string;
  downloadURL?: string;
  mimeType?: string;
  sizeBytes?: number;
};

export type GridItem =
  | { kind: "folder"; createdAtClient: number; folder: Folder }
  | { kind: "doc"; createdAtClient: number; doc: DocItem };
