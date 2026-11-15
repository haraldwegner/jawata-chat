# jawata Java

Java language support from the one jawata engine, in VS Code, Cursor and Theia: problems from text you have not saved, and (as the engine learns them) navigation and completion. The engine already holds your projects for the agent; this extension lets the editor ask the same engine, so the editor and the agent never run two Java servers over the same files.

It starts the launcher you name in `jawataJava.server` (the jawata program with `--lsp`), which forwards the editor's messages to the engine that is already running. It starts no language server of its own.

Install no other Java language-server extension beside it. If one is installed (`jawataJava.rivalExtensions`, by default `redhat.java`), the extension says so, logs it, and offers a button that uninstalls it together with the extensions that need it.
