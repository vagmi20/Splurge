"""
Development runner with auto-reload
Monitors Python files and automatically restarts the app when changes are detected.
Usage: python3 dev_runner.py
"""

import subprocess
import sys
import time
from pathlib import Path
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler


class FileChangeHandler(FileSystemEventHandler):
    def __init__(self, restart_callback):
        self.restart_callback = restart_callback
        self.last_modified = time.time()

    def on_modified(self, event):
        # Ignore JSON data file changes
        if event.src_path.endswith('.json'):
            return
        
        # Ignore non-Python files
        if not event.src_path.endswith('.py'):
            return

        # Debounce: ignore rapid successive changes
        current_time = time.time()
        if current_time - self.last_modified < 1:
            return
        
        self.last_modified = current_time
        print(f"\n✓ Detected change in {Path(event.src_path).name}")
        self.restart_callback()


class AppReloader:
    def __init__(self, main_script="finance_app.py"):
        self.main_script = main_script
        self.process = None
        self.observer = None

    def start_app(self):
        """Start the main app"""
        print(f"🚀 Starting {self.main_script}...")
        self.process = subprocess.Popen(
            [sys.executable, self.main_script],
            cwd=Path(__file__).parent
        )

    def stop_app(self):
        """Stop the running app"""
        if self.process:
            print("⏹️  Stopping app...")
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.kill()

    def restart_app(self):
        """Restart the app"""
        self.stop_app()
        time.sleep(0.5)
        self.start_app()

    def setup_watcher(self):
        """Setup file watcher"""
        handler = FileChangeHandler(self.restart_app)
        self.observer = Observer()
        self.observer.schedule(handler, path=Path(__file__).parent, recursive=False)
        self.observer.start()
        print("👀 Watching for file changes...")

    def run(self):
        """Start the app and watcher"""
        try:
            self.setup_watcher()
            self.start_app()
            print("Press Ctrl+C to stop\n")
            
            # Keep the watcher running
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\n👋 Shutting down...")
            self.stop_app()
            if self.observer:
                self.observer.stop()
            self.observer.join()


if __name__ == "__main__":
    reloader = AppReloader()
    reloader.run()
