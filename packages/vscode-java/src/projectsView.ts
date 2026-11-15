import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';

/** The engine's answer to `jawata/javaProjects`. */
interface JavaClass { name: string; uri: string }
interface JavaPackage { name: string; classes: JavaClass[] }
interface JavaLibrary { name: string; path: string }
interface JavaProject { name: string; root: string; packages: JavaPackage[]; libraries: JavaLibrary[] }

type Node =
  | { kind: 'project'; project: JavaProject }
  | { kind: 'libraries'; project: JavaProject }
  | { kind: 'library'; library: JavaLibrary }
  | { kind: 'package'; pkg: JavaPackage }
  | { kind: 'class'; cls: JavaClass };

/** The Explorer's Java Projects view (D53 (o)): the projects, packages, classes and libraries of the engine. */
export class ProjectsView implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private projects: JavaProject[] = [];

  constructor(private readonly clientOf: () => LanguageClient | undefined) {}

  async refresh(): Promise<void> {
    const client = this.clientOf();
    this.projects = client ? await client.sendRequest<JavaProject[]>('jawata/javaProjects', {}) : [];
    this.changed.fire();
  }

  getChildren(node?: Node): Node[] {
    if (!node) { return this.projects.map(project => ({ kind: 'project', project })); }
    switch (node.kind) {
      case 'project': return [
        ...node.project.packages.map(pkg => ({ kind: 'package', pkg } as Node)),
        ...(node.project.libraries.length > 0 ? [{ kind: 'libraries', project: node.project } as Node] : []),
      ];
      case 'libraries': return node.project.libraries.map(library => ({ kind: 'library', library }));
      case 'package': return node.pkg.classes.map(cls => ({ kind: 'class', cls }));
      default: return [];
    }
  }

  getTreeItem(node: Node): vscode.TreeItem {
    const collapsed = vscode.TreeItemCollapsibleState.Collapsed;
    switch (node.kind) {
      case 'project': return Object.assign(new vscode.TreeItem(node.project.name, collapsed), { iconPath: new vscode.ThemeIcon('project'), tooltip: node.project.root });
      case 'libraries': return Object.assign(new vscode.TreeItem('Libraries', collapsed), { iconPath: new vscode.ThemeIcon('library') });
      case 'library': return Object.assign(new vscode.TreeItem(node.library.name), { iconPath: new vscode.ThemeIcon('package'), tooltip: node.library.path });
      case 'package': return Object.assign(new vscode.TreeItem(node.pkg.name, collapsed), { iconPath: new vscode.ThemeIcon('symbol-namespace') });
      case 'class': {
        const item = new vscode.TreeItem(node.cls.name);
        item.iconPath = new vscode.ThemeIcon('symbol-class');
        if (node.cls.uri) { item.command = { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.parse(node.cls.uri)] }; }
        return item;
      }
    }
  }
}
