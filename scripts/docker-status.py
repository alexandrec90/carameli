#!/usr/bin/env python3
"""Comprehensive Docker stack diagnostic.

Writes three artifacts consumed by the `fix-docker` skill:
  logs/docker/health.log    -- container status, sick-container logs, healthchecks
  logs/docker/config.log    -- compose config validation, Docker resource usage
  logs/docker/app-logs.log  -- recent app container logs (always collected)

Uses `docker ps --filter` for status queries to avoid Compose v2 hangs.
"""
import re
import sys

import docker_common as dc

HEALTH = "health.log"
CONFIG = "config.log"
APP_LOGS = "app-logs.log"

_SICK_RE = re.compile(r"unhealthy|Exited|exited|Restarting", re.IGNORECASE)


def main() -> int:
    project = dc.project_name()
    dc.ensure_docker_log_dir()

    print("\n=== Docker Stack Diagnostic ===")
    for label, art in (("Health", HEALTH), ("Config", CONFIG), ("App logs", APP_LOGS)):
        print(f"{label} artifact : {dc.DOCKER_LOG_DIR / art}")
    print()

    has_errors = False

    # ============================================================
    # CONFIG: Compose file validation + Docker resource usage
    # ============================================================
    config_lines = ["Docker Config Diagnostic", f"Timestamp: {dc.timestamp()}", ""]

    print("--- Compose Config Validation ---")
    cfg_out, cfg_code, cfg_timeout = dc.run_with_timeout(
        ["docker", "compose", "config", "--quiet"], timeout=15)
    if cfg_code == 0 and not cfg_timeout:
        print("  Compose file valid.")
        config_lines += ["=== Compose Config ===", "Valid.", ""]
    else:
        has_errors = True
        state = "TIMEOUT" if cfg_timeout else "INVALID"
        print(f"  [{'WARN' if cfg_timeout else 'FAIL'}] Compose config {state.lower()}")
        config_lines += [f"=== Compose Config ({state}) ===", *cfg_out, ""]

    print("--- Docker Resources ---")
    df_out, df_code, df_timeout = dc.run_with_timeout(["docker", "system", "df"], timeout=15)
    label = "TIMEOUT" if df_timeout else ("" if df_code == 0 else " (failed)")
    config_lines += [f"=== Docker Resources (docker system df){label} ===", *df_out, ""]

    dc.write_artifact(CONFIG, "\n".join(config_lines) + "\n")

    # ============================================================
    # HEALTH: Container status + sick container logs + healthchecks
    # ============================================================
    health_lines = ["Docker Health Diagnostic", f"Timestamp: {dc.timestamp()}", ""]

    print("--- Container Status ---")
    table, table_code, table_timeout = dc.docker_ps("table {{.Names}}\t{{.Status}}\t{{.Ports}}")
    parse_lines, _, _ = dc.docker_ps("{{.Names}}|{{.Status}}")

    if table_code != 0:
        msg = ("docker ps timed out -- Docker daemon may be stuck" if table_timeout
               else "docker ps failed -- is Docker running?")
        print(f"  [FAIL] {msg}")
        health_lines.append(msg)
        dc.write_artifact(HEALTH, "\n".join(health_lines) + "\n")
        return 1

    for line in table:
        print(f"  {line}")
    health_lines += ["=== Container Status ===", "", *table, ""]

    entries = dc.parse_status_entries(parse_lines, project)
    sick = dc.sick_services(entries, _SICK_RE)

    if not sick:
        health_lines.append("All containers healthy.")
        print("  All containers healthy.")
    else:
        has_errors = True
        summary = f"Unhealthy/exited services: {', '.join(sick)}"
        print(f"  {summary}")
        health_lines += [summary, ""]
        for svc in sick:
            print(f"--- Logs: {svc} (last 40 lines) ---")
            logs = dc.docker_logs(f"{project}-{svc}-1", tail=40)
            health_lines += [f"=== Logs: {svc} (last 40 lines) ===", *logs, ""]
        health_lines.append("=== Healthcheck Details ===")
        for svc in sick:
            ids, _, id_timeout = dc.docker_ps("{{.ID}}", all_containers=False,
                                              extra_filters=[dc.service_filter(svc)])
            if ids and not id_timeout:
                hc, _, _ = dc.run_with_timeout(
                    ["docker", "inspect", "--format", "{{json .State.Health}}", ids[0]], timeout=10)
                health_lines.append(f"{svc} : {' '.join(hc)}")
        health_lines.append("")

    dc.write_artifact(HEALTH, "\n".join(health_lines) + "\n")

    # ============================================================
    # APP LOGS: Always collect recent app container output
    # ============================================================
    app_lines = ["App container logs", f"Timestamp: {dc.timestamp()}", ""]
    app_status, _, app_timeout = dc.docker_ps("{{.Status}}", all_containers=False,
                                              extra_filters=[dc.service_filter("app")])
    blob = " ".join(app_status)
    if app_timeout or not re.search(r"Up|running|Restarting|Exited|exited", blob):
        print("--- App Logs ---\n  [SKIP] service 'app' has no container.")
        app_lines.append("service 'app' has no container.")
    else:
        logs = dc.docker_logs(f"{project}-app-1", tail=100)
        app_lines += [f"App status: {blob}", "",
                      f"=== docker logs {project}-app-1 --tail 100 ===", *logs]
    dc.write_artifact(APP_LOGS, "\n".join(app_lines) + "\n")

    print(dc.banner("ISSUES FOUND" if has_errors else "ALL CLEAR"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
