import unittest
from collections import deque
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from autonomous_scan import (
    RepresentativeSampler,
    StateRecord,
    FrontierItem,
    dump_hierarchy,
    is_immediate_loop,
    is_authentication_action,
    pop_fair_frontier,
    recover_from_visible_root,
    root_navigation_action,
    semantic_action_key,
    semantic_state_id,
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
        actions = discover_actions(hierarchy)
        self.assertEqual([action.label for action in actions], ["All", "Today"])
        self.assertTrue(actions[0].selected)
        self.assertFalse(actions[1].selected)

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

    def test_selected_tab_and_countdown_do_not_create_new_semantic_state(self):
        first = """<?xml version="1.0"?>
<hierarchy>
  <node text="All" class="android.view.View" clickable="true"
        enabled="true" selected="true" bounds="[0,0][100,100]" />
  <node text="Today" class="android.view.View" clickable="true"
        enabled="true" selected="false" bounds="[100,0][200,100]" />
  <node text="Starts in 12:34" class="android.widget.TextView"
        clickable="false" enabled="true" bounds="[0,100][200,200]" />
</hierarchy>"""
        second = first.replace(
            'text="All" class="android.view.View" clickable="true"\n'
            '        enabled="true" selected="true"',
            'text="All" class="android.view.View" clickable="true"\n'
            '        enabled="true" selected="false"',
        ).replace(
            'text="Today" class="android.view.View" clickable="true"\n'
            '        enabled="true" selected="false"',
            'text="Today" class="android.view.View" clickable="true"\n'
            '        enabled="true" selected="true"',
        ).replace("Starts in 12:34", "Starts in 12:21")
        self.assertEqual(
            semantic_state_id(first, discover_actions(first)),
            semantic_state_id(second, discover_actions(second)),
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

    def test_calendar_samples_one_ordinary_date_and_today(self):
        sampler = RepresentativeSampler()
        actions = []
        for index in range(1, 32):
            prefix = "Today, " if index == 24 else ""
            actions.append(
                Action(
                    index=index - 1,
                    label=f"{prefix}Friday, July {index}, 2026",
                    class_name="android.widget.TextView",
                    bounds=f"[0,{index * 10}][100,{index * 10 + 9}]",
                    x=50,
                    y=index * 10 + 4,
                    risk="safe",
                )
            )
        variants = infer_contextual_action_variants(actions)
        by_index = {item["action_index"]: item for item in variants}
        accepted = [
            action
            for action in actions
            if sampler.accept("Select date", action, by_index[action.index])
        ]
        self.assertEqual(
            [action.label for action in accepted],
            ["Friday, July 1, 2026", "Today, Friday, July 24, 2026"],
        )
        self.assertEqual(
            sum(len(group["skipped"]) for group in sampler.records()), 29
        )

    def test_calendar_samples_only_one_year(self):
        sampler = RepresentativeSampler()
        actions = [
            Action(
                index=index,
                label=f"Navigate to year {2023 + index}",
                class_name="android.widget.TextView",
                bounds=f"[0,{index * 10}][100,{index * 10 + 9}]",
                x=50,
                y=index * 10 + 4,
                risk="safe",
            )
            for index in range(21)
        ]
        variants = infer_contextual_action_variants(actions)
        by_index = {item["action_index"]: item for item in variants}
        accepted = [
            action
            for action in actions
            if sampler.accept("Select date", action, by_index[action.index])
        ]
        self.assertEqual(
            [action.label for action in accepted],
            ["Navigate to year 2023"],
        )
        self.assertEqual(
            sum(len(group["skipped"]) for group in sampler.records()), 20
        )

    def test_calendar_classifies_dates_after_first_24_controls(self):
        actions = [
            Action(
                index=index,
                label=f"Control {index}",
                class_name="android.view.View",
                bounds=f"[0,{index}][100,{index + 1}]",
                x=50,
                y=index,
                risk="safe",
            )
            for index in range(24)
        ]
        actions.extend(
            Action(
                index=24 + index,
                label=f"Friday, July {index + 1}, 2023",
                class_name="android.widget.TextView",
                bounds=f"[0,{index + 30}][100,{index + 31}]",
                x=50,
                y=index + 30,
                risk="safe",
            )
            for index in range(7)
        )
        variants = infer_contextual_action_variants(actions)
        self.assertEqual(
            {item["action_index"] for item in variants},
            set(range(24, 31)),
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
            semantic_preferred_action_index=-1,
        )
        metadata = {
            "package": "com.example",
            "serial": "emulator",
            "model": "local",
        }
        with TemporaryDirectory() as directory:
            output = Path(directory)
            (output / "transitions").mkdir()
            write_outputs(
                output,
                metadata,
                {"state": state},
                [],
                [],
                [],
                0,
                [],
                [],
                "frontier_exhausted",
            )
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
                output,
                metadata,
                {"state": state},
                [],
                [issue],
                [],
                0,
                [],
                [],
                "frontier_exhausted",
            )
            report = (output / "agent_report.md").read_text()
            self.assertIn("What happened", report)
            self.assertIn("Likely causes", report)
            self.assertIn("How to reproduce", report)
            self.assertIn("Developer next steps", report)
            self.assertNotIn("Screen catalog", report)

    def test_scanner_has_no_target_app_restart_commands(self):
        scanner = (
            Path(__file__).resolve().parents[1] / "autonomous_scan.py"
        ).read_text()
        self.assertNotIn('"force-stop"', scanner)
        self.assertNotIn('"am", "start"', scanner)
        self.assertNotIn("KEYCODE_BACK", scanner)

    def test_fair_scheduler_rotates_to_another_semantic_screen(self):
        def state(identifier, screen):
            return StateRecord(
                id=identifier,
                ordinal=0,
                path=[],
                hierarchy="",
                screenshot="",
                actions_found=1,
                scrollables=0,
                screen_name=screen,
                purpose="",
                flow_stage="browse",
                semantic_confidence=90,
                semantic_evidence=[],
                semantic_action_variants=[],
                semantic_preferred_action_index=-1,
            )

        states = {
            "same-1": state("same-1", "Live classes"),
            "same-2": state("same-2", "Live classes"),
            "other": state("other", "Home"),
        }
        frontier = deque(
            [
                FrontierItem("same-1", [], {"label": "Today"}),
                FrontierItem("same-2", [], {"label": "Tomorrow"}),
                FrontierItem("other", [], {"label": "Practice"}),
            ]
        )
        selected = pop_fair_frontier(
            frontier, states, "Live classes", consecutive_on_screen=4
        )
        self.assertEqual(selected.source_id, "other")

    def test_root_discovery_prefers_visible_home_over_back(self):
        back = Action(
            0,
            "Back",
            "android.view.View",
            "[0,0][100,100]",
            50,
            50,
            "safe",
        )
        home = Action(
            1,
            "Home",
            "android.view.View",
            "[0,100][100,200]",
            50,
            150,
            "safe",
        )
        self.assertEqual(root_navigation_action([back, home]), home)

    def test_root_discovery_allows_only_contextual_flow_exit(self):
        generic_exit = Action(
            0,
            "Exit",
            "android.view.View",
            "[0,0][100,100]",
            50,
            50,
            "safe",
            context="Account settings",
        )
        quiz_exit = Action(
            1,
            "Exit",
            "android.view.View",
            "[0,100][100,200]",
            50,
            150,
            "safe",
            context="Exit Model Set Test question timer",
        )
        self.assertIsNone(root_navigation_action([generic_exit]))
        self.assertEqual(root_navigation_action([quiz_exit]), quiz_exit)

    def test_root_discovery_closes_named_overlays(self):
        close_filter = Action(
            0,
            "Close filter",
            "android.view.View",
            "[0,0][100,100]",
            50,
            50,
            "safe",
        )
        self.assertEqual(
            root_navigation_action([close_filter]), close_filter
        )

    def test_authentication_routes_are_excluded(self):
        login = Action(
            0,
            "Log in",
            "android.view.View",
            "[0,0][100,100]",
            50,
            50,
            "safe",
            context="Account access",
        )
        course = Action(
            1,
            "Browse Course",
            "android.view.View",
            "[0,100][100,200]",
            50,
            150,
            "safe",
        )
        self.assertTrue(is_authentication_action(login))
        self.assertFalse(is_authentication_action(course))

    @patch("autonomous_scan.foreground_package", return_value="com.example")
    @patch("autonomous_scan.observe_after_action")
    @patch("autonomous_scan.perform_action")
    @patch("autonomous_scan.discover_visible_root")
    def test_failed_session_can_recover_from_root_and_replay_target_route(
        self,
        discover_root,
        perform,
        observe,
        _foreground,
    ):
        root = """<hierarchy>
  <node text="Study" class="android.view.View" clickable="true"
        enabled="true" bounds="[0,0][100,100]" />
</hierarchy>"""
        destination = """<hierarchy>
  <node text="Course details" class="android.widget.TextView"
        clickable="false" enabled="true" bounds="[0,0][200,100]" />
  <node text="Open lesson" class="android.view.View" clickable="true"
        enabled="true" bounds="[0,100][200,200]" />
</hierarchy>"""
        discover_root.return_value = root
        observe.return_value = destination
        root_id = semantic_state_id(root, discover_actions(root))
        target_id = semantic_state_id(
            destination, discover_actions(destination)
        )
        restored, hierarchy, state_id, path = recover_from_visible_root(
            "emulator",
            "com.example",
            "adb",
            root_id,
            [
                {
                    "label": "Study",
                    "class_name": "android.view.View",
                    "bounds": "[0,0][100,100]",
                }
            ],
            target_id,
        )
        self.assertTrue(restored)
        self.assertEqual(hierarchy, destination)
        self.assertEqual(state_id, target_id)
        self.assertEqual([step["label"] for step in path], ["Study"])
        perform.assert_called_once()

    @patch("autonomous_scan.discover_visible_root")
    def test_root_recovery_rejects_a_stale_or_wrong_baseline(
        self, discover_root
    ):
        expected_root = """<hierarchy>
  <node text="Home" class="android.view.View" clickable="true"
        enabled="true" bounds="[0,0][100,100]" />
</hierarchy>"""
        wrong_root = expected_root.replace("Home", "Trial purchase")
        discover_root.return_value = wrong_root
        restored, _, state_id, path = recover_from_visible_root(
            "emulator",
            "com.example",
            "adb",
            semantic_state_id(expected_root, discover_actions(expected_root)),
            [],
            "target",
        )
        self.assertFalse(restored)
        self.assertNotEqual(state_id, "")
        self.assertEqual(path, [])

    @patch("autonomous_scan.run_adb")
    def test_hierarchy_capture_retries_after_android_tooling_timeout(
        self, run
    ):
        from subprocess import TimeoutExpired

        run.side_effect = [
            TimeoutExpired("adb", 5),
            "",
            (
                "notice\n<?xml version='1.0'?><hierarchy></hierarchy>"
                "\nUI hierarchy dumped to: /dev/tty"
            ),
        ]
        self.assertEqual(
            dump_hierarchy("emulator", "adb"),
            "<?xml version='1.0'?><hierarchy></hierarchy>",
        )
        self.assertEqual(run.call_count, 3)


if __name__ == "__main__":
    unittest.main()
