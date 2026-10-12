from __future__ import annotations

import importlib.util
import py_compile
import shutil
from pathlib import Path


MARKER = "LIUXIANLAB_SAFE_SEAL_CROP_V2"


def find_target() -> Path:
    spec = importlib.util.find_spec(
        "mineru.model.ocr.pytorch_paddle"
    )

    if spec is None or spec.origin is None:
        raise RuntimeError(
            "Cannot find mineru.model.ocr.pytorch_paddle"
        )

    return Path(spec.origin).resolve()


def main():
    target = find_target()

    print("Target:")
    print(target)

    original = target.read_text(
        encoding="utf-8"
    )

    if MARKER in original:
        print("Patch already installed.")
        return

    backup = target.with_name(
        target.name
        + ".before-liuxianlab-seal-fix-v2"
    )

    if not backup.exists():
        shutil.copy2(
            target,
            backup,
        )

        print("Backup:")
        print(backup)
    else:
        print("Backup already exists:")
        print(backup)

    anchor = """def get_model_params"""

    if anchor not in original:
        raise RuntimeError(
            "Cannot find get_model_params anchor"
        )

    patch = r'''
# LIUXIANLAB_SAFE_SEAL_CROP_V2
#
# MinerU seal OCR occasionally receives a malformed polygon
# which causes DocVortex to raise:
#
#     ValueError: Unsupported warp settings
#
# A single malformed seal must not abort parsing of the
# complete document. Process seal polygons individually and
# skip only known geometry-related failures.
#
_LIUXIANLAB_ORIGINAL_CROP_BY_POLYS_CALL = (
    CropByPolys.__call__
)


def _liuxianlab_safe_crop_by_polys_call(
    self,
    *args,
    **kwargs,
):
    # Expected CropByPolys call:
    #
    #     instance(image, boxes)
    #
    # If the API shape is different, preserve MinerU's
    # original behavior instead of guessing.
    if len(args) < 2:
        return (
            _LIUXIANLAB_ORIGINAL_CROP_BY_POLYS_CALL(
                self,
                *args,
                **kwargs,
            )
        )

    boxes = args[1]

    try:
        box_count = len(boxes)
    except Exception:
        return (
            _LIUXIANLAB_ORIGINAL_CROP_BY_POLYS_CALL(
                self,
                *args,
                **kwargs,
            )
        )

    if box_count == 0:
        return []

    safe_crops = []

    for index in range(
        box_count
    ):
        single_args = list(
            args
        )

        try:
            single_box = (
                boxes[index:index + 1]
            )
        except Exception:
            single_box = [
                boxes[index]
            ]

        single_args[1] = (
            single_box
        )

        try:
            result = (
                _LIUXIANLAB_ORIGINAL_CROP_BY_POLYS_CALL(
                    self,
                    *single_args,
                    **kwargs,
                )
            )

        except ValueError as exc:
            message = str(
                exc
            )

            geometry_error = (
                "Unsupported warp settings"
                in message
                or
                "too small"
                in message.lower()
                or
                "perspective"
                in message.lower()
            )

            if not geometry_error:
                raise

            logger.warning(
                "[seal-ocr] skipped malformed "
                "seal polygon {}: {}",
                index,
                message,
            )

            continue

        if result is None:
            continue

        if isinstance(
            result,
            list,
        ):
            safe_crops.extend(
                result
            )

        elif isinstance(
            result,
            tuple,
        ):
            safe_crops.extend(
                list(result)
            )

        else:
            safe_crops.append(
                result
            )

    return safe_crops


CropByPolys.__call__ = (
    _liuxianlab_safe_crop_by_polys_call
)


'''

    patched = original.replace(
        anchor,
        patch + "\n" + anchor,
        1,
    )

    target.write_text(
        patched,
        encoding="utf-8",
    )

    try:
        py_compile.compile(
            str(target),
            doraise=True,
        )

    except Exception:
        shutil.copy2(
            backup,
            target,
        )

        raise

    print()
    print(
        "MinerU safe seal patch V2 installed."
    )

    print(
        "Malformed seal polygons will be skipped."
    )


if __name__ == "__main__":
    main()
