# @saadjs/pi-exit

A tiny pi extension that adds `/exit` for gracefully exiting the coding agent.

## Install

```bash
pi install npm:@saadjs/pi-exit
```

## Usage

Run the command from the pi TUI:

```text
/exit
```

Pi waits for any active agent work to settle, emits `session_shutdown`, and then exits.
