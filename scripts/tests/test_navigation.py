import unittest

from autonomous_scan import is_immediate_loop
from local_model_scan import Action, discover_actions


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


if __name__ == "__main__":
    unittest.main()
