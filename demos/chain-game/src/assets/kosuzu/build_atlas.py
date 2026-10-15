"""Pack Kosuzu PNG layers using the supplied GIFs as pose-order references.

Requires Pillow. The bundled source files are sufficient to rebuild the atlas;
this script never reads from or writes to the user's Downloads directory.
Gameplay timings are annotated separately from the GIF playback durations.
"""

from pathlib import Path
import json

from PIL import Image


ROOT = Path(__file__).resolve().parent
ATLAS_WIDTH = 512
PADDING = 2


def gif_frames(name):
    image = Image.open(ROOT / "reference" / f"{name}.gif")
    frames = []
    for index in range(image.n_frames):
        image.seek(index)
        frames.append((image.convert("RGBA"), image.info["duration"]))
    return frames


def source_frame(path):
    return Image.open(ROOT / "source" / path).convert("RGBA")


def main():
    images = []
    clips = {}
    x = y = PADDING
    row_height = 0

    def pack(image):
        nonlocal x, y, row_height
        width, height = image.size
        if x + width + PADDING > ATLAS_WIDTH:
            x = PADDING
            y += row_height + PADDING
            row_height = 0
        rect = {"x": x, "y": y, "width": width, "height": height}
        images.append((image, (x, y)))
        x += width + PADDING
        row_height = max(row_height, height)
        return rect

    def add_clip(clip_id, reference, loop, origin, frame_durations=None, duration_scale=1):
        frames = []
        reference_frames = gif_frames(reference)
        frame_count = len(frame_durations) if frame_durations is not None else len(reference_frames)
        for index in range(1, frame_count + 1):
            duration = (
                frame_durations[index - 1]
                if frame_durations is not None
                else round(reference_frames[index - 1][1] * duration_scale)
            )
            if clip_id in ("attack", "slam"):
                # Composite the separate character and slash layers on their
                # shared canvas. Explicit timings can include recovery PNGs
                # that the reference GIF omits or holds for much longer.
                stem = "melee" if clip_id == "attack" else "slam"
                char = f"{stem}/{stem}_char{index}.png"
                fx = f"{stem}/{stem}_fx{index}.png"
                image = source_frame(char)
                sources = [f"source/{char}"]
                if (ROOT / "source" / fx).exists():
                    image = Image.alpha_composite(image, source_frame(fx))
                    sources.append(f"source/{fx}")
            elif clip_id == "hurt":
                # The second GIF pose is absent from hurt.png.
                # Read its composited RGBA image, retaining native transparency.
                image = reference_frames[index - 1][0]
                sources = [f"reference/{reference}.gif#{index}"]
            else:
                path = f"{reference}/{reference}{index}.png"
                image = source_frame(path)
                sources = [f"source/{path}"]
            frames.append({
                "sources": sources,
                "rect": pack(image),
                "origin": {"x": origin[0], "y": origin[1]},
                "durationMs": duration,
            })
        clips[clip_id] = {
            "frames": frames,
            "durationMs": sum(frame["durationMs"] for frame in frames),
            "loop": loop,
        }

    add_clip("idle", "idle", True, (16, 64))
    add_clip("run", "run", True, (16, 64), duration_scale=0.5)
    # The source GIF contains two swings. Keep only the first swing and its
    # recovery so that every fruit receives exactly one authored slash.
    add_clip("attack", "melee", False, (48, 64), frame_durations=(32, 44, 40, 30, 34))
    # The second pose starts the first visible slash. Its blade point is in
    # unscaled canvas coordinates, independent of the shared ground origin.
    clips["attack"]["contactMs"] = clips["attack"]["frames"][0]["durationMs"]
    clips["attack"]["contactFrame"] = 1
    clips["attack"]["contactPoint"] = {"x": 76, "y": 49}
    # A single vertical slash: raise, strike, fading blade, recover. Retain all
    # eight authored PNG poses, compressing the reference GIF's long holds.
    add_clip("slam", "slam", False, (64, 64), frame_durations=(16, 24, 34, 30, 24, 26, 22, 24))
    clips["slam"]["contactMs"] = sum(frame["durationMs"] for frame in clips["slam"]["frames"][:2])
    clips["slam"]["contactFrame"] = 2
    clips["slam"]["contactPoint"] = {"x": 92, "y": 36}
    clips["slam"]["cutAngleRad"] = 1.5707963267948966
    add_clip("hurt", "hurt", False, (16, 64))

    # No authored start/stop sequence exists in the pack. Zero-length slots let
    # the timeline move directly between idle/run/attack without invented poses.
    for clip_id, fallback in (("start", "run"), ("stop", "idle")):
        clips[clip_id] = {
            "frames": [{**clips[fallback]["frames"][0], "durationMs": 0}],
            "durationMs": 0,
            "loop": False,
        }

    needed_height = y + row_height + PADDING
    height = 1 << (needed_height - 1).bit_length()
    atlas = Image.new("RGBA", (ATLAS_WIDTH, height))
    for image, position in images:
        atlas.paste(image, position)
    atlas.save(ROOT / "kosuzu.png", optimize=True)
    manifest = {
        "image": "kosuzu.png",
        "size": [ATLAS_WIDTH, height],
        "sourceFacing": "right",
        "referenceHeight": 38,
        "groundOffsetCells": 0.34,
        "timingSource": (
            "reference/idle.gif, run.gif, melee.gif, slam.gif, hurt.gif provide pose order; "
            "gameplay timings are annotated separately (run at 2x speed, first melee swing only, "
            "all eight slam PNG poses in 200ms)"
        ),
        "clips": clips,
    }
    (ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
