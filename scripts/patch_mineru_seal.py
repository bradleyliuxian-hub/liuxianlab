from __future__ import annotations

import importlib.util
import py_compile
import shutil
from pathlib import Path


MARKER = "LIUXIANLAB_SAFE_SEAL_CROP_V3"

MODULE_NAME = (
    "mineru.model.ocr.seal_crop"
)


def find_target() -> Path:
    spec = importlib.util.find_spec(
        MODULE_NAME
    )

    if (
        spec is None
        or
        spec.origin is None
    ):
        raise RuntimeError(
            "Cannot find "
            + MODULE_NAME
        )

    return Path(
        spec.origin
    ).resolve()


PATCH = r'''

# ============================================================
# LIUXIANLAB_SAFE_SEAL_CROP_V3
#
# MinerU seal OCR can occasionally produce a malformed polygon.
#
# DocVortex then raises:
#
#     ValueError: Unsupported warp settings
#
# A malformed seal polygon must not abort parsing of the entire
# contract.
#
# This patch is installed in seal_crop.py itself so it applies
# to BOTH:
#
#     pp_ocr_v6_onnx.py
#     pytorch_paddle.py
#
# Strategy:
#
# - process seal polygons one at a time;
# - preserve all normal crops;
# - skip ONLY polygons that raise the known DocVortex
#   "Unsupported warp settings" error;
# - propagate every other exception normally.
# ============================================================

import warnings as _liuxianlab_warnings


_LIUXIANLAB_ORIGINAL_CROP_BY_POLYS_CALL_V3 = (
    CropByPolys.__call__
)


def _liuxianlab_safe_crop_by_polys_call_v3(
    self,
    *args,
    **kwargs,
):
    /*
    Python does not support C-style comments.
    */


CropByPolys.__call__ = (
    _LIUXIANLAB_SAFE_CROP_PLACEHOLDER
)

'''

# Build the actual patch separately so the code inserted into
# MinerU remains simple Python.
PATCH = r'''

# ============================================================
# LIUXIANLAB_SAFE_SEAL_CROP_V3
#
# Protect document parsing from one malformed seal polygon.
#
# Applies to both ONNX and Torch OCR because both import the
# shared CropByPolys class from this module.
# ============================================================

import warnings as _liuxianlab_warnings


_LIUXIANLAB_ORIGINAL_CROP_BY_POLYS_CALL_V3 = (
    CropByPolys.__call__
)


def _liuxianlab_safe_crop_by_polys_call_v3(
    self,
    *args,
    **kwargs,
):

    # Normal expected call:
    #
    #     cropper(image, boxes)
    #
    # Preserve original behavior if the API shape differs.
    if len(args) < 2:

        return (
            _LIUXIANLAB_ORIGINAL_CROP_BY_POLYS_CALL_V3(
                self,
                *args,
                **kwargs,
            )
        )


    boxes = args[1]


    try:

        box_count = len(
            boxes
        )

    except Exception:

        return (
            _LIUXIANLAB_ORIGINAL_CROP_BY_POLYS_CALL_V3(
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
                boxes[
                    index:index + 1
                ]
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
                _LIUXIANLAB_ORIGINAL_CROP_BY_POLYS_CALL_V3(
                    self,
                    *single_args,
                    **kwargs,
                )
            )


        except ValueError as exc:

            message = str(
                exc
            )


            if (
                "Unsupported warp settings"
                not in message
            ):

                raise


            _liuxianlab_warnings.warn(
                (
                    "[liuxianlab seal OCR] "
                    f"skipped malformed seal polygon "
                    f"{index}: {message}"
                ),
                RuntimeWarning,
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
                list(
                    result
                )
            )


        else:

            safe_crops.append(
                result
            )


    return safe_crops


CropByPolys.__call__ = (
    _liuxianlab_safe_crop_by_polys_call_v3
)

'''


def main():

    target = find_target()


    print(
        "Target:"
    )

    print(
        target
    )


    original = target.read_text(
        encoding="utf-8"
    )


    if MARKER in original:

        print(
            "V3 patch already installed."
        )

        return


    if "class CropByPolys" not in original:

        raise RuntimeError(
            "CropByPolys class not found in seal_crop.py"
        )


    backup = target.with_name(
        target.name
        + ".before-liuxianlab-seal-fix-v3"
    )


    if not backup.exists():

        shutil.copy2(
            target,
            backup,
        )


        print(
            "Backup:"
        )

        print(
            backup
        )


    else:

        print(
            "Backup already exists:"
        )

        print(
            backup
        )


    patched = (
        original.rstrip()
        + "\n\n"
        + PATCH.strip()
        + "\n"
    )


    target.write_text(
        patched,
        encoding="utf-8",
    )


    try:

        py_compile.compile(
            str(
                target
            ),
            doraise=True,
        )


    except Exception:

        print(
            "Patch syntax check failed."
        )

        print(
            "Restoring backup..."
        )


        shutil.copy2(
            backup,
            target,
        )


        raise


    print()
    print(
        "MinerU safe seal patch V3 installed."
    )


if __name__ == "__main__":

    main()
