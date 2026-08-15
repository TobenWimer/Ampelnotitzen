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

export type DocItem = {
  id: string;
  name: string;
  color?: FolderColor;
  createdAtClient: number;
};

export type GridItem =
  | { kind: "folder"; createdAtClient: number; folder: Folder }
  | { kind: "doc"; createdAtClient: number; doc: DocItem };
