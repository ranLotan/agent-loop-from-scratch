// Lesson 1: your first API call. Run with: npm run hello
//
// Goal: ask the model which category a merchant belongs to, then print
// the answer and what the call cost in tokens.

import { client, MODEL } from "./client";

const merchant = 'אונלי וויפס בע"מ';
const categories = ["מזון ומשקאות", "ילדים", "ריהוט ובית", "טיפוח ויופי", "שונות"];

// 1. The request: rules in `system`, data in `messages`.
const messageResponse = await client.messages.create({
  model: MODEL,
  max_tokens: 1000,
  system:
    "You categorize Israeli credit card transactions by merchant name. " +
    "Pick exactly one category from the list the user gives you; never invent a new one. " +
    "If none fits, answer שונות. Reply with the category name only.",
  messages: [
    {
      role: "user",
      content: [{ type: "text", text: `Merchant: ${merchant}\nCategories: ${categories.join(", ")}` }],
    },
  ],
});

// 2. The answer: content is an array of blocks; print only the text ones.
for (const block of messageResponse.content) {
  if (block.type === "text") console.log("Answer:", block.text);
}

// 3. Why it stopped, and what it cost.
const { input_tokens, output_tokens } = messageResponse.usage;
const cost = (input_tokens * 4 + output_tokens * 20) / 1_000_000;
console.log("stop_reason:", messageResponse.stop_reason);
console.log(`tokens: ${input_tokens} in / ${output_tokens} out → $${cost.toFixed(5)}`);
