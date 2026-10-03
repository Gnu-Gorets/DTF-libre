import json
import urllib.parse
import urllib.request


def fetch_topics():
    topics, cursor, seen = {}, None, set()
    for _ in range(20):
        params = {"q": "", "type": "2"}
        if cursor:
            params.update(lastId=cursor[0], lastSortingValue=cursor[1])
        url = "https://api.dtf.ru/v2.51/search/subsites?" + urllib.parse.urlencode(params)
        with urllib.request.urlopen(url, timeout=20) as response:
            result = json.load(response)["result"]
        for item in result.get("items", []):
            data = item.get("data", {})
            if data.get("id") and data.get("url"):
                topics[data["id"]] = data
        cursor = result.get("lastId"), result.get("lastSortingValue")
        if not result.get("items") or cursor in seen:
            return topics
        seen.add(cursor)
    raise AssertionError("Pagination did not terminate")


if __name__ == "__main__":
    topics = fetch_topics()
    with urllib.request.urlopen(
        "https://api.dtf.ru/v2.7/discovery/topics", timeout=20
    ) as response:
        native = {item["data"]["id"]: item["data"] for item in json.load(response)["result"]}
    extra = {topic["name"] for topic_id, topic in topics.items() if topic_id not in native}
    assert len(native) == 69, len(native)
    assert len(topics) == 74, len(topics)
    assert extra == {"Мемы", "О, порно", "Сломалось", "Виабу", "Драма"}, extra
    print(f"OK: {len(native)} native topics + {len(extra)} extras")
