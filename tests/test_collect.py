import sys
from pathlib import Path
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from collect import parse_feed, merge, canonical


class CollectionTests(unittest.TestCase):
    def parse(self, xml):
        return parse_feed(xml.encode(), {"id":"test", "name":"Test"}, "2026-11-17T01:00:00+00:00")

    def test_rss_metadata_only_and_dedup(self):
        rows = self.parse('<rss><channel><item><title>Award news</title><link>https://example.com/post?utm_source=rss</link><description>Do not copy this article</description><pubDate>Tue, 17 Nov 2026 01:00:00 GMT</pubDate></item></channel></rss>')
        merged, new, changed = merge([], rows)
        self.assertEqual((new, changed), (1, 0))
        self.assertNotIn("description", rows[0])
        self.assertEqual(rows[0]["verification"], "待核實")
        self.assertEqual(merge(merged, rows)[1:], (0, 0))

    def test_changed_title_reopens_verification(self):
        a = self.parse('<rss><channel><item><title>Old</title><link>https://example.com/a</link></item></channel></rss>')
        a[0]["verification"] = "已核實"
        b = self.parse('<rss><channel><item><title>New</title><link>https://example.com/a</link></item></channel></rss>')
        rows, new, changed = merge(a, b)
        self.assertEqual((new, changed), (0, 1))
        self.assertEqual(rows[0]["verification"], "待核實")

    def test_atom(self):
        rows = self.parse('<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>News</title><link rel="alternate" href="https://example.com/a"/><updated>2026-11-17T09:00:00+08:00</updated></entry></feed>')
        self.assertEqual(len(rows), 1)
        self.assertTrue(rows[0]["published_at"].startswith("2026-11-17T01:00:00"))

    def test_block_page_is_failure_not_empty_success(self):
        for body in ['<html><body>Login</body></html>', '<!DOCTYPE rss><rss><channel/></rss>']:
            with self.assertRaises(ValueError): self.parse(body)

    def test_valid_empty_feed(self):
        self.assertEqual(self.parse('<rss><channel><title>Empty</title></channel></rss>'), [])

    def test_reject_script_links(self):
        with self.assertRaises(ValueError): canonical('javascript:alert(1)')


if __name__ == '__main__': unittest.main()
