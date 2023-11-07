import OpenAI from "openai";
export class Keyword {

    public static extract(): void {
        (async () => {
            const openai = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY,
            });

            const chatCompletion = await openai.chat.completions.create({
                messages: [{ role: "user", content: "Say this is a test" }],
                model: "gpt-3.5-turbo",
            });
            console.log('chatCompletion: ', chatCompletion.choices[0]?.message?.content);
        })().catch(() => console.log('error'));
    }
}