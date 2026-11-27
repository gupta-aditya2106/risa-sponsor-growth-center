export default function handler(req, res) {
  res.status(200).json({ ai: Boolean(process.env.GEMINI_API_KEY) });
}
