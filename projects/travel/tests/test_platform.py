import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path
from subprocess import TimeoutExpired


ROOT = Path(__file__).resolve().parents[3]
SERVE_PATH = ROOT / "serve.py"
CHECK_SCRIPT = ROOT / "scripts" / "check.ps1"


def load_serve():
    spec = importlib.util.spec_from_file_location("platform_serve", SERVE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ServeToolStatusTest(unittest.TestCase):
    def test_missing_tools_reports_build_commands(self):
        serve = load_serve()
        with tempfile.TemporaryDirectory() as tmp:
            project = Path(tmp) / "project"
            project.mkdir()
            (project / "package.json").write_text("{}", encoding="utf-8")
            missing_dist = project / "dist"
            ready = Path(tmp) / "ready"
            ready.mkdir()
            (ready / "index.html").write_text("", encoding="utf-8")
            incomplete = Path(tmp) / "incomplete"
            incomplete.mkdir()

            tools = {
                "/ready/": ready,
                "/incomplete/": incomplete,
                "/missing/": missing_dist,
            }
            missing = serve.missing_tools(tools)

            by_prefix = {item["prefix"]: item for item in missing}
            self.assertEqual(set(by_prefix), {"/missing/", "/incomplete/"})
            self.assertEqual(by_prefix["/missing/"]["directory"], missing_dist.resolve())
            self.assertEqual(by_prefix["/missing/"]["build_command"], f'cd "{project.resolve()}"; npm install; npm run build')
            self.assertEqual(by_prefix["/incomplete/"]["directory"], incomplete.resolve())


class CheckScriptPlanTest(unittest.TestCase):
    def test_fast_plan_uses_local_install(self):
        try:
            result = subprocess.run(
                [
                    "pwsh",
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    str(CHECK_SCRIPT),
                    "-Fast",
                    "-Plan",
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=10,
            )
        except TimeoutExpired as exc:
            self.fail(f"check.ps1 did not support -Fast/-Plan and kept running: {exc}")

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("npm install --no-audit --no-fund", result.stdout)


if __name__ == "__main__":
    unittest.main()
