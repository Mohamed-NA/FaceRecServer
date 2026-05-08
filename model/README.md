# model/

This directory holds the face embeddings database.

| File                   | Description                                                          |
|------------------------|----------------------------------------------------------------------|
| `face_embeddings.json` | `{ "name": [[128-d vector], …] }` — written on every live enrollment |

`face_embeddings.json` is gitignored (it is runtime state). The file is created automatically
the first time someone is enrolled through the UI. The directory must exist on disk; this
`README.md` ensures git tracks it.
