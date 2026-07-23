import unittest

from runtime_diagnostics import analyze_logcat, redact


class RuntimeDiagnosticsTests(unittest.TestCase):
    def test_redacts_headers_and_json_secrets(self):
        value = (
            "Authorization: Bearer secret\n"
            'https://example.test?access_token=abc&view=all\n'
            '{"access_token":"abc","name":"Ada"}'
        )
        self.assertEqual(
            redact(value),
            "Authorization: <redacted>\n"
            "https://example.test?access_token=<redacted>&view=all\n"
            '{"access_token":"<redacted>","name":"Ada"}',
        )

    def test_parsing_incident_correlates_request_response_and_dto(self):
        raw = """
1710000000.1 101 101 I OkHttp: --> GET https://example.test/users
1710000000.2 101 101 I OkHttp: Authorization: Bearer secret
1710000000.3 101 101 I OkHttp: <-- 200 https://example.test/users
1710000000.4 101 101 I OkHttp: {"id":"wrong","access_token":"abc"}
1710000000.5 101 101 E App: com.example.UserDto JsonDataException: Expected an int but was STRING
"""
        incidents = analyze_logcat(
            raw,
            state_id="state",
            screen_name="User profile",
            action={"label": "Profile"},
            path=[{"label": "Profile"}],
        )
        self.assertEqual(len(incidents), 1)
        incident = incidents[0]
        self.assertEqual(incident["evidence"]["dto_parser"], "com.example.UserDto")
        self.assertIn("curl -X GET", incident["evidence"]["curl"])
        self.assertNotIn("Bearer secret", str(incident))
        self.assertNotIn('"abc"', str(incident))
        self.assertEqual(incident["evidence"]["response"]["status"], 200)

    def test_strict_mode_incident_contains_screen_and_navigation_context(self):
        raw = """
1710000000.1 101 101 D StrictMode: StrictMode policy violation: DiskReadViolation
1710000000.2 101 101 W System.err: at com.example.HomeRepository.load(HomeRepository.kt:42)
"""
        incidents = analyze_logcat(
            raw,
            state_id="home",
            screen_name="Home dashboard",
            action={"label": "Refresh"},
            path=[{"label": "Home"}, {"label": "Refresh"}],
        )
        self.assertEqual(incidents[0]["category"], "strict_mode")
        self.assertEqual(incidents[0]["screen_name"], "Home dashboard")
        self.assertEqual(incidents[0]["how_it_occurred"]["action"]["label"], "Refresh")


if __name__ == "__main__":
    unittest.main()
