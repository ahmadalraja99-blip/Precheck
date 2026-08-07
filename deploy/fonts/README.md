# Runtime report fonts

Place two administrator-supplied Arabic-capable TrueType fonts here before starting the backend:

- `regular.ttf`
- `bold.ttf`

Font binaries are intentionally ignored by Git and mounted read-only at `/app/fonts`. Confirm that their license permits server use. The report renderer returns a controlled configuration/readability error when either configured file is absent; it does not log the configured path.
