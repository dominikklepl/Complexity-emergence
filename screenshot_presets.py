"""
Capture screenshots of every preset in every simulation.
Requires the server to be running: uv run server.py

Run with:
  /home/dominikklepl/.local/share/uv/tools/playwright/bin/python screenshot_presets.py
"""
import asyncio
import os
from playwright.async_api import async_playwright

URL = "http://localhost:5000"
OUT_DIR = "screenshots"
WARMUP_MS = 4000  # ms to let each preset develop before capture

SIMS = ["rd", "osc", "boids", "neural"]

async def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            args=["--enable-webgl", "--use-gl=swiftshader"],
            headless=True,
        )
        page = await browser.new_page(viewport={"width": 1280, "height": 800})
        await page.goto(URL, wait_until="networkidle")
        await page.wait_for_timeout(1000)  # let JS init settle

        for sim_id in SIMS:
            print(f"\n=== {sim_id} ===")
            # Select simulation tab
            await page.locator(".sim-select").select_option(sim_id)
            await page.wait_for_timeout(1500)

            # Find all preset buttons
            preset_btns = page.locator(".preset-btn")
            count = await preset_btns.count()
            print(f"  {count} presets found")

            for i in range(count):
                btn = preset_btns.nth(i)
                label = (await btn.text_content() or f"preset_{i}").strip()
                safe_label = label.replace(" ", "_").replace("/", "-")

                await btn.click()
                await page.wait_for_timeout(WARMUP_MS)

                path = os.path.join(OUT_DIR, f"{sim_id}_{i:02d}_{safe_label}.png")
                await page.screenshot(path=path)
                print(f"  [{i}] {label} → {path}")

        await browser.close()
    print(f"\nDone. Screenshots saved to ./{OUT_DIR}/")

asyncio.run(main())
