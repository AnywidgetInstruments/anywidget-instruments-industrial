# Parity cases

Cases shared by the Python tests (`tests/test_parity.py`) and the front-end
tests (`js/test/parity.test.ts`): where the same rule is implemented in the
kernel and in the front end (HOST-005), both must give these results.
Non-finite numbers are written as the strings `"nan"`, `"inf"`, `"-inf"`.
