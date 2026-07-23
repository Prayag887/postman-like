import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from autonomous_scan import (
    RepresentativeSampler,
    StateRecord,
    is_immediate_loop,
    semantic_action_key,
    state_issues,
    transition_issues,
    write_outputs,
)
from local_model_scan import (
    Action,
    discover_actions,
    infer_contextual_action_variants,
)


class NavigationTests(unittest.TestCase):
    def test_selected_controls_are_not_offered_as_actions(self):
        hierarchy = """<?xml version="1.0"?>
<hierarchy>
  <node text="All" class="android.widget.Button" clickable="true"
        enabled="true" selected="true" bounds="[0,0][100,100]" />
  <node text="Today" class="android.widget.Button" clickable="true"
        enabled="true" selected="false" bounds="[100,0][200,100]" />
</hierarchy>"""
        self.assertEqual([action.label for action in discover_actions(hierarchy)], ["Today"])

    def test_same_semantic_action_is_not_repeated_immediately(self):
        previous = {
            "label": "All",
            "class_name": "android.widget.Button",
            "bounds": "[0,0][100,100]",
        }
        moved_control = Action(
            index=0,
            label="All",
            class_name="android.widget.Button",
            bounds="[10,10][110,110]",
            x=60,
            y=60,
            risk="safe",
        )
        self.assertTrue(is_immediate_loop([previous], moved_control))

    def test_dynamic_states_share_one_semantic_tab_identity(self):
        all_tab = Action(
            index=0,
            label="All",
            class_name="android.view.View",
            bounds="[18,177][114,273]",
            x=66,
            y=225,
            risk="safe",
        )
        first = semantic_action_key("Live class|All", all_tab, None)
        moved = Action(
            index=0,
            label="All",
            class_name="android.view.View",
            bounds="[20,180][116,276]",
            x=68,
            y=228,
            risk="safe",
        )
        self.assertEqual(
            first, semantic_action_key("Live class|All", moved, None)
        )

    def test_collection_representatives_are_not_collapsed_as_tabs(self):
        details = Action(
            index=4,
            label="View Details",
            class_name="android.view.View",
            bounds="[64,644][352,740]",
            x=208,
            y=692,
            risk="safe",
        )
        classification = {
            "collection": "Live class cards",
            "variant": "Upcoming",
        }
        self.assertIsNone(
            semantic_action_key("Live class", details, classification)
        )

    def test_different_action_can_continue_the_flow(self):
        previous = {
            "label": "All",
            "class_name": "android.widget.Button",
            "bounds": "[0,0][100,100]",
        }
        today = Action(
            index=0,
            label="Today",
            class_name="android.widget.Button",
            bounds="[100,0][200,100]",
            x=150,
            y=50,
            risk="safe",
        )
        self.assertFalse(is_immediate_loop([previous], today))

    def test_repeated_cards_use_model_derived_variants_without_a_fixed_taxonomy(self):
        sampler = RepresentativeSampler()
        accepted = []
        for variant in ("recorded archive", "interactive room", "waitlisted"):
            for index in range(40):
                action = Action(
                    index=index,
                    label="View Details",
                    class_name="android.view.View",
                    bounds=f"[0,{index}][700,{index + 100}]",
                    x=350,
                    y=index + 50,
                    risk="safe",
                    context=f"Session · {variant} · item {index}",
                )
                classification = {
                    "collection": "learning sessions",
                    "variant": variant,
                }
                if sampler.accept("Learning", action, classification):
                    accepted.append(action.label)
        self.assertEqual(len(accepted), 3)
        self.assertEqual(
            sum(len(group["skipped"]) for group in sampler.records()), 117
        )

    def test_contrastive_fallback_discovers_unconfigured_variant_field(self):
        actions = [
            Action(
                index=0,
                label="Open",
                class_name="android.view.View",
                bounds="[0,0][100,100]",
                x=50,
                y=50,
                risk="safe",
                context="Alpha Session · Recorded archive · By Ada · 45 min · Open",
            ),
            Action(
                index=1,
                label="Open",
                class_name="android.view.View",
                bounds="[0,100][100,200]",
                x=50,
                y=150,
                risk="safe",
                context="Beta Session · Interactive room · By Ada · 45 min · Open",
            ),
            Action(
                index=2,
                label="Open",
                class_name="android.view.View",
                bounds="[0,200][100,300]",
                x=50,
                y=250,
                risk="safe",
                context="Gamma Session · Waitlisted · By Ada · 45 min · Open",
            ),
        ]
        inferred = infer_contextual_action_variants(actions)
        self.assertEqual(
            [item["variant"] for item in inferred],
            ["Recorded archive", "Interactive room", "Waitlisted"],
        )

    def test_any_safe_control_without_an_effect_is_reported(self):
        issues = transition_issues(
            "same",
            "same",
            {
                "label": "Mystery button",
                "class_name": "android.widget.Button",
            },
            900,
            "screenshots/state.png",
            "Profile",
            [{"label": "Profile"}, {"label": "Mystery button"}],
            [],
        )
        self.assertEqual(len(issues), 1)
        self.assertIn("no observable effect", issues[0]["title"])
        self.assertTrue(issues[0]["likely_causes"])

    def test_unlabelled_controls_are_not_reported_as_bugs(self):
        action = Action(
            index=0,
            label="Unlabelled control",
            class_name="android.view.View",
            bounds="[0,48][91,1232]",
            x=45,
            y=640,
            risk="safe",
        )
        hierarchy = """<?xml version="1.0"?>
<hierarchy><node text="Visible screen" class="android.view.View"
 bounds="[0,0][720,1280]" /></hierarchy>"""
        self.assertEqual(
            state_issues("state", hierarchy, [action], "screen.png"), []
        )

    def test_issue_report_only_exists_when_issues_exist(self):
        state = StateRecord(
            id="state",
            ordinal=0,
            path=[],
            hierarchy="hierarchies/state.xml",
            screenshot="screenshots/state.png",
            actions_found=1,
            scrollables=0,
            screen_name="Home",
            purpose="Browse content",
            flow_stage="browse",
            semantic_confidence=90,
            semantic_evidence=["Home"],
            semantic_action_variants=[],
        )
        metadata = {
            "package": "com.example",
            "serial": "emulator",
            "model": "local",
        }
        with TemporaryDirectory() as directory:
            output = Path(directory)
            (output / "transitions").mkdir()
            write_outputs(output, metadata, {"state": state}, [], [], [], 0, [])
            self.assertFalse((output / "agent_report.md").exists())
            issue = {
                "category": "navigation",
                "severity": "major",
                "confidence": 90,
                "state_id": "state",
                "title": "Control produced no observable effect: Open",
                "evidence": {"action": {"label": "Open"}},
            }
            write_outputs(
                output, metadata, {"state": state}, [], [issue], [], 0, []
            )
            report = (output / "agent_report.md").read_text()
            self.assertIn("What happened", report)
            self.assertIn("Likely causes", report)
            self.assertIn("How to reproduce", report)
            self.assertIn("Developer next steps", report)
            self.assertNotIn("Screen catalog", report)


if __name__ == "__main__":
    unittest.main()
