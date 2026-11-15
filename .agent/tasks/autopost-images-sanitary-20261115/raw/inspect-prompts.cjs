const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const local = createRequire(path.resolve('package.json'));
const { allTopics, buildImagePrompt, buildTextInstructions } = local('./src/lib/channel-autopost/topics.ts');
const scene = 'Professional kitchen with potted basil on the windowsill and flowers on the worktop';
const prompts = {
  planning: buildTextInstructions(),
  savedScene: buildImagePrompt(allTopics()[0], scene),
  missingTopic: buildImagePrompt({ title: 'Saved topic title' }, scene),
  emptyScene: buildImagePrompt({ title: 'Kitchen' }, ''),
  truncatedLongScene: buildImagePrompt({ title: 'Kitchen' }, scene.repeat(200)).slice(0, 8000),
};
for (const prompt of Object.values(prompts)) {
  assert.match(prompt, /No potted plants/);
  assert.match(prompt, /including windowsills/);
  assert.match(prompt, /food ingredients in clean food-grade containers/);
}
const service = fs.readFileSync('src/lib/channel-autopost/service.server.ts', 'utf8');
assert.ok(service.includes('const prompt = buildImagePrompt(topic ?? { title: row.topicTitle }, row.imagePrompt ?? "");'));
assert.ok(service.includes('startImageJob(prompt, IMAGE_SIZE)'));
assert.equal((service.match(/startImageJob\(/g) ?? []).length, 1);
const source = ['src/lib/channel-autopost/topics.ts', 'src/lib/channel-autopost/topics.test.ts', 'src/lib/channel-autopost/service.server.ts'].map(file => ({ file, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }));
fs.writeFileSync(__dirname + '/prompts.json', JSON.stringify(prompts, null, 2) + '\n');
fs.writeFileSync(__dirname + '/prompt-review.json', JSON.stringify({ status: 'PASS', checkedAt: new Date().toISOString(), source, checks: ['planning and final image prompts carry sanitary requirements', 'saved scenes, empty scenes, missing metadata and gateway truncation covered', 'the only image-job call uses the mandatory wrapper including missing-topic fallback'], limitation: 'Verifies prompt construction only; no image job, generated-pixel inspection, database change or publication is performed.' }, null, 2) + '\n');
console.log('PASS: current prompt chain and gateway boundary reviewed without external calls');
