
// import { askAI } from "./utils/ai";

// async function main() {
//   const result = await askAI(
//     "Reply with exactly: Gemini connection successful"
//   );

//   console.log(result);
// }

// main().catch((error) => {
//   console.error(error.message);
//   process.exitCode = 1;
// });


import { askAI } from "./utils/ai";

async function main() {
  console.log("Sending request to Gemini...");

  const result = await askAI(
    "Reply with exactly: Gemini connection successful"
  );

  console.log("Gemini response:", result);
}

main().catch((error) => {
  console.error("Gemini test failed:", error.message);
  process.exitCode = 1;
});