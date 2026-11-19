import assert from "node:assert/strict";
import test from "node:test";
import { gglPersonalThreadKey, parseGglPersonalHistory, parseGglPersonalThreadKey } from "./gogetlinks-personal-chat";

test("reads personal history omitted from the general index", () => {
  const key = gglPersonalThreadKey(884931, 366517);
  assert.deepEqual(parseGglPersonalThreadKey(key), { campaignId: 884931, siteId: 366517 });
  assert.equal(parseGglPersonalThreadKey("884931/366517"), null);
  assert.equal(parseGglPersonalHistory("<script>window.close()</script>", key), null);
  const result = parseGglPersonalHistory(`
    <div id="pm_content"><div id="message_print_list">
      <div class="private-message__item">
        <div class="private-message__name">Вебмастер viarum.ru</div>
        <div class="private-message__date">19.11.2026 16:29</div>
        <div class="message_text copying" data-id="9789660">Рубрика «Бизнес».</div>
      </div>
      <div class="private-message__item">
        <div class="private-message__name">Оптимизатор wesetup.ru</div>
        <div class="private-message__date">19.11.2026 16:24</div>
        <div class="message_text copying" data-id="9789659">Здравствуйте!<br>В какой рубрике выйдет статья?</div>
      </div>
    </div></div>
    <script>PrivateMessagePersonalData.unreadMessageIds = [9789660];</script>
  `, key);
  assert.equal(result?.unreadCount, 1);
  assert.deepEqual(result?.messages.map(message => [message.id, message.direction, message.date]), [
    [`${key}:9789659`, "outbound", "2026-11-19T16:24:00+03:00"],
    [`${key}:9789660`, "inbound", "2026-11-19T16:29:00+03:00"],
  ]);
  assert.equal(result?.messages[0]?.text, "Здравствуйте!\nВ какой рубрике выйдет статья?");
});
