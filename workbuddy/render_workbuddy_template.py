#!/usr/bin/env python3
"""Render a Ping Class release template with one WorkBuddy user's database IDs.

This helper is intentionally offline: it performs no network requests and does
not read environment variables, credentials, browser data, or WorkBuddy state.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any


MAX_HTML_BYTES = 50 * 1024 * 1024
EXPECTED_APP_ID = "io.github.yihuier.workbuddy-ping-class"
DATABASE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,128}$")
EXTERNAL_SCRIPT_RE = re.compile(r"<script[^>]+\bsrc\s*=", re.IGNORECASE)
EXTERNAL_STYLE_RE = re.compile(
    r"<link[^>]+\brel\s*=\s*(['\"])stylesheet\1[^>]+\bhref\s*=",
    re.IGNORECASE,
)
EXTERNAL_IMAGE_RE = re.compile(
    r"<img[^>]+(?:src|srcset)=['\"]https?://(?![^'\"]*(?:workbuddy|codebuddy))",
    re.IGNORECASE,
)


class RenderError(ValueError):
    pass


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RenderError(f"无法读取 JSON：{path.name}") from error
    if not isinstance(value, dict):
        raise RenderError(f"JSON 顶层必须是对象：{path.name}")
    return value


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def mapping_id(raw_value: Any, alias: str) -> str:
    value = raw_value.get("id") if isinstance(raw_value, dict) else raw_value
    if not isinstance(value, str) or not DATABASE_ID_RE.fullmatch(value):
        raise RenderError(f"{alias} 的 databaseId 缺失或格式非法")
    return value


def render(manifest_path: Path, template_path: Path, mapping_path: Path, output_path: Path) -> None:
    manifest = read_json(manifest_path)
    raw_mapping = read_json(mapping_path)
    nested_mapping = raw_mapping.get("databaseBindings")
    mapping = nested_mapping if isinstance(nested_mapping, dict) else raw_mapping

    if manifest.get("protocolVersion") != 1:
        raise RenderError("不支持的安装协议版本")
    if manifest.get("appId") != EXPECTED_APP_ID:
        raise RenderError("manifest appId 不匹配")

    version = manifest.get("version")
    if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?", version):
        raise RenderError("manifest version 不是有效 SemVer")

    try:
        template_bytes = template_path.read_bytes()
    except OSError as error:
        raise RenderError(f"无法读取模板：{template_path.name}") from error
    if not template_bytes or len(template_bytes) > MAX_HTML_BYTES:
        raise RenderError("HTML 模板为空或超过 50 MiB")

    assets = manifest.get("assets")
    if not isinstance(assets, dict):
        raise RenderError("manifest 缺少 assets")
    template_asset = assets.get("template")
    if not isinstance(template_asset, dict):
        raise RenderError("manifest 缺少模板资产")
    expected_hash = template_asset.get("sha256")
    if not isinstance(expected_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_hash):
        raise RenderError("manifest 缺少模板 SHA-256")
    if sha256_bytes(template_bytes) != expected_hash:
        raise RenderError("HTML 模板 SHA-256 校验失败")

    try:
        html = template_bytes.decode("utf-8")
    except UnicodeDecodeError as error:
        raise RenderError("HTML 模板不是 UTF-8") from error

    bindings = manifest.get("databaseBindings")
    if not isinstance(bindings, dict) or not bindings:
        raise RenderError("manifest 缺少 databaseBindings")

    extra_aliases = sorted(set(mapping) - set(bindings))
    if extra_aliases:
        raise RenderError(f"映射包含 manifest 未声明的 alias：{', '.join(extra_aliases)}")

    rendered_ids: dict[str, str] = {}
    for alias, binding in bindings.items():
        if not isinstance(alias, str) or not isinstance(binding, dict):
            raise RenderError("databaseBindings 格式非法")
        placeholder = binding.get("placeholder")
        if not isinstance(placeholder, str) or not placeholder.startswith("__PING_CLASS_DB_"):
            raise RenderError(f"{alias} 的 placeholder 非法")
        if placeholder not in html:
            raise RenderError(f"模板中缺少 {alias} 的 placeholder")
        if alias not in mapping:
            raise RenderError(f"映射中缺少 {alias}")
        database_id = mapping_id(mapping[alias], alias)
        rendered_ids[alias] = database_id
        html = html.replace(placeholder, database_id)

    if len(set(rendered_ids.values())) != len(rendered_ids):
        raise RenderError("不同逻辑表不能绑定到同一个 databaseId")

    page = manifest.get("page")
    if not isinstance(page, dict):
        raise RenderError("manifest 缺少 page 配置")
    version_placeholder = page.get("appVersionPlaceholder")
    if not isinstance(version_placeholder, str) or version_placeholder not in html:
        raise RenderError("模板中缺少应用版本 placeholder")
    html = html.replace(version_placeholder, version)

    unresolved = sorted(set(re.findall(r"__PING_CLASS_[A-Z0-9_]+__", html)))
    if unresolved:
        raise RenderError(f"模板仍有未替换 placeholder：{', '.join(unresolved)}")

    forbidden_ids = manifest.get("forbiddenDatabaseIds", [])
    if not isinstance(forbidden_ids, list) or any(not isinstance(item, str) for item in forbidden_ids):
        raise RenderError("forbiddenDatabaseIds 格式非法")
    leaked_ids = [database_id for database_id in forbidden_ids if database_id and database_id in html]
    if leaked_ids:
        raise RenderError("渲染结果仍包含开发者 databaseId")

    missing_ids = [alias for alias, database_id in rendered_ids.items() if database_id not in html]
    if missing_ids:
        raise RenderError(f"渲染结果缺少 databaseId：{', '.join(missing_ids)}")
    if EXTERNAL_SCRIPT_RE.search(html) or EXTERNAL_STYLE_RE.search(html):
        raise RenderError("渲染结果仍依赖外部 JS/CSS")
    if EXTERNAL_IMAGE_RE.search(html):
        raise RenderError("渲染结果仍包含未托管的第三方图片链接")

    output_bytes = html.encode("utf-8")
    if len(output_bytes) > MAX_HTML_BYTES:
        raise RenderError("渲染结果超过 50 MiB")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(output_bytes)


def main() -> int:
    parser = argparse.ArgumentParser(description="Render a user-specific Ping Class WorkBuddy page")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--template", required=True)
    parser.add_argument("--mapping", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    try:
        render(
            Path(args.manifest),
            Path(args.template),
            Path(args.mapping),
            Path(args.output),
        )
    except RenderError as error:
        sys.stderr.write(f"Ping Class 模板渲染失败：{error}\n")
        return 1

    sys.stdout.write(f"Ping Class 模板渲染完成：{Path(args.output).name}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
