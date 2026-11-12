
"""Configure fine-grained OpenSearch roles for Memory Lane."""

import json
from manage_index import signed_request

ACCOUNT = "456157355328"

LF1_ROLE = (
    f"arn:aws:iam::{ACCOUNT}:role/"
    "memory-lane-index-photos-role"
)

LF2_ROLE = (
    f"arn:aws:iam::{ACCOUNT}:role/service-role/"
    "search_photos-role-2825ja5i"
)


def configure(name, action, iam_role):
    role = {
        "cluster_permissions": [],
        "index_permissions": [
            {
                "index_patterns": ["photos"],
                "allowed_actions": [action]
            }
        ],
        "tenant_permissions": []
    }

    mapping = {
        "users": [],
        "backend_roles": [iam_role],
        "hosts": []
    }

    for path, body in [
        (f"/_plugins/_security/api/roles/{name}", role),
        (f"/_plugins/_security/api/rolesmapping/{name}", mapping),
    ]:
        status, result = signed_request("PUT", path, body)
        print(status, path, json.dumps(result))


if __name__ == "__main__":
    configure("memory_lane_lf1_writer", "index", LF1_ROLE)
    configure("memory_lane_lf2_searcher", "search", LF2_ROLE)
    print("OpenSearch role setup complete")
