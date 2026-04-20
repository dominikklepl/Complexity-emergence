import pytest
import json
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import server as app_module

@pytest.fixture
def client():
    app_module.app.config["TESTING"] = True
    with app_module.app.test_client() as c:
        yield c

def test_config_includes_neural(client):
    """neural sim must appear in content dict."""
    resp = client.get("/api/config")
    assert resp.status_code == 200
    data = json.loads(resp.data)
    assert "neural" in data["content"], "neural missing from /api/config content"

def test_config_rd_has_preset_params(client):
    """reaction-diffusion preset params must be present."""
    resp = client.get("/api/config")
    data = json.loads(resp.data)
    rd = data["content"].get("rd", {})
    assert "preset_params" in rd, "preset_params missing from rd content"
    assert "labyrinth" in rd["preset_params"]
    assert "f" in rd["preset_params"]["labyrinth"]
    assert "k" in rd["preset_params"]["labyrinth"]

def test_config_all_sims_have_preset_params(client):
    """All four sims must expose preset_params."""
    resp = client.get("/api/config")
    data = json.loads(resp.data)
    for sim_id in ["rd", "osc", "boids", "neural"]:
        assert "preset_params" in data["content"].get(sim_id, {}), \
            f"{sim_id} missing preset_params"
