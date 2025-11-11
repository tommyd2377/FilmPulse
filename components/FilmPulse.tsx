"use client"

import { useState, useRef, useEffect, FormEvent, ChangeEvent } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTwitter, faTelegram, faLinkedin, faGithub } from '@fortawesome/free-brands-svg-icons';
import { Loader2, Send } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import OpenAI from "openai"
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions"

interface RecommendedMovie {
  title: string
  poster: string | null
  tmdbUrl: string | null
  releaseYear: number | string
  genre: string
}

interface Message {
  content: string
  isBot: boolean
  movies?: RecommendedMovie[]
}

const OPENAI_API_KEY = process.env.NEXT_PUBLIC_OPENAI_API_KEY
const TMDB_API_KEY = process.env.NEXT_PUBLIC_TMDB_API_KEY

const openaiClient: OpenAI | null = OPENAI_API_KEY
  ? new OpenAI({
      apiKey: OPENAI_API_KEY,
      dangerouslyAllowBrowser: true,
    })
  : null

export default function FilmPulse() {
  // Provide an explicit type for messages state
  const [messages, setMessages] = useState<Message[]>([])
  const [inputText, setInputText] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  // Specify that the ref will refer to an HTMLDivElement or be null
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const [preference, setPreference] = useState(0.5); // 0 for Indie, 1 for Blockbusters

  useEffect(() => {
    if (messages.length === 0) {
      console.log("Initializing chat with welcome message")
      setMessages([
        {
          content:
            "Hi! I'm your film recommendation assistant. Tell me some movies you like, and I'll suggest similar ones!",
          isBot: true,
        },
      ])
    }
    console.log("Messages updated:", messages)
    scrollToBottom()
  }, [messages])

  const scrollToBottom = () => {
    console.log("Scrolling to bottom of chat")
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  function extractMovieTitles(text: string): string[] {
    const regex = /\*\*(.*?)\*\*/g; // Matches **Movie Title**
    const matches = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      matches.push(match[1]);
    }
    return matches;
  }

  function generateMovieResponse(movies: { title: string; poster: string | null }[]): string {
    return movies
      .map(
        (movie) =>
          `<div style="margin-bottom: 10px;">
            <strong style="color: #9b6bcc;">${movie.title}</strong><br/>
            ${
              movie.poster
                ? `<img src="${movie.poster}" alt="${movie.title}" style="width: 150px; border-radius: 8px;"/>`
                : "(No poster available)"
            }
          </div>`
      )
      .join("");
  }

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!inputText.trim()) {
      console.log("Empty input submitted, ignoring.");
      return;
    }
  
    console.log("User submitted:", inputText);
    setIsLoading(true);
    setMessages((prev) => [...prev, { content: inputText, isBot: false, movies: [] }]);
    setInputText("");
  
    try {
      if (!openaiClient) {
        console.error("Missing OpenAI API key");
        setMessages((prevMessages) => [
          ...prevMessages,
          {
            content: "OpenAI API key is not configured. Please add NEXT_PUBLIC_OPENAI_API_KEY to your environment.",
            isBot: true,
            movies: [],
          },
        ]);
        return;
      }

      const preferenceText =
        preference === 0
          ? "Focus only on indie, lesser-known, or international films. Avoid blockbusters."
          : preference === 1
          ? "Recommend mostly blockbusters or high-profile movies."
          : "Include a mix of both indie/hidden gems and blockbusters.";

      const conversation: ChatCompletionMessageParam[] = [
        {
          role: "system",
          content: `
            You are a knowledgeable and enthusiastic film expert.
            Continue the conversation naturally, building on previous recommendations.
            The user has mentioned these movies:

            ${preferenceText}

            Maintain a friendly, conversational tone using contractions and occasional emojis.
            Format movie titles in **bold** with brief, intriguing descriptions.
          `,
        },
        ...messages.map<ChatCompletionMessageParam>((msg) => ({
          role: msg.isBot ? "assistant" : "user",
          content: msg.content,
        })),
        { role: "user", content: `Suggest movies similar to: ${inputText}` },
      ];

      console.log("Sending API request to OpenAI:", conversation);
      const response = await openaiClient.chat.completions.create({
        model: "gpt-4o",
        messages: conversation,
        temperature: 1.0,
      });
      console.log("OpenAI API response received:", response);

      const recommendedMoviesText = response.choices[0].message.content ?? "";
      console.log("Recommended movies text:", recommendedMoviesText);
  
      // Extract movie titles
      const movieTitles = extractMovieTitles(recommendedMoviesText);
      console.log("Extracted movie titles:", movieTitles);
  
      // Fetch TMDB poster images and movie details
      const moviesWithPosters = await Promise.all(
        movieTitles.map(async (title) => {
          if (!TMDB_API_KEY) {
            console.warn("Missing TMDB API key; skipping enrichment for", title);
            return { title, poster: null, tmdbUrl: null, releaseYear: "N/A", genre: "Unknown Genre" };
          }

          const tmdbResponse = await fetch(
            `https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(title)}&api_key=${TMDB_API_KEY}`
          );
          const tmdbData = await tmdbResponse.json();
          if (tmdbData.results.length > 0) {
            const movie = tmdbData.results[0]; // Get first result

            // Fetch full movie details for genre and year
            const movieDetailsResponse = await fetch(
              `https://api.themoviedb.org/3/movie/${movie.id}?api_key=${TMDB_API_KEY}`
            );
            const movieDetails = await movieDetailsResponse.json();

            return {
              title,
              poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
              tmdbUrl: `https://www.themoviedb.org/movie/${movie.id}`,
              releaseYear: movie.release_date ? new Date(movie.release_date).getFullYear() : "N/A",
              genre: movieDetails.genres?.[0]?.name || "Unknown Genre",
            };
          } else {
            return { title, poster: null, tmdbUrl: null, releaseYear: "N/A", genre: "Unknown Genre" };
          }
        })
      );
  
      console.log("Movies with poster URLs and TMDB links:", moviesWithPosters);
  
      // Update state with AI text response + movies
      setMessages((prevMessages) => [
        ...prevMessages,
        {
          content: recommendedMoviesText,
          isBot: true,
          movies: moviesWithPosters,
        },
      ]);
    } catch (error) {
      console.error("Error fetching recommendations or TMDB data:", error);
      setMessages((prevMessages) => [
        ...prevMessages,
        {
          content: "Sorry, I'm having trouble connecting to the recommendation service. Please try again later.",
          isBot: true,
          movies: [],
        },
      ]);
    } finally {
      setIsLoading(false);
      scrollToBottom();
      console.log("API request completed");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white py-8">
      <div className="max-w-4xl mx-auto p-4">
        <header className="text-center mb-8">
          <h1 className="text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600 mb-4">
            FilmPulse
          </h1>
          <p className="text-lg text-gray-300">
            Discover hidden gems and international cinema with AI-powered recommendations
          </p>
        </header>

        {/* Slider for Movie Preference */}
<div className="flex flex-col items-center mb-6">
  <p className="text-gray-300 text-sm mb-2">
    Movie Preference: {preference === 0 ? "Indie/Hidden Gems" : preference === 1 ? "Blockbusters" : "Mixed"}
  </p>
  <input
    type="range"
    min="0"
    max="1"
    step="0.1"
    value={preference}
    onChange={(e) => setPreference(parseFloat(e.target.value))}
    className="w-3/4 cursor-pointer"
  />
  <div className="flex justify-between w-3/4 text-gray-400 text-xs mt-1">
    <span>Indie/Hidden Gems</span>

    <span>Blockbusters</span>
  </div>
</div>

        

        <Card className="bg-gray-800 border-gray-700 shadow-xl">
          <CardContent className="p-6">
            <div className="space-y-4 mb-4 max-h-[60vh] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-gray-800">
            <AnimatePresence>
  {messages.map((msg, index) => (
    <motion.div
      key={index}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3 }}
      className={`flex ${msg.isBot ? "justify-start" : "justify-end"}`}
    >
      <div
        className={`max-w-[80%] p-3 rounded-lg ${
          msg.isBot ? "bg-gray-700 text-white" : "bg-purple-600 text-white"
        }`}
      >
        {/* Render AI text response */}
        <div
          dangerouslySetInnerHTML={{
            __html: msg.content.replace(
              /\*\*(.*?)\*\*/g,
              "<strong class='text-purple-300'>$1</strong>"
            ),
          }}
        />


{msg.movies && msg.movies.length > 0 && (
  <div className="flex flex-wrap mt-2">
    {msg.movies.map((movie, idx) => (
      <div key={idx} className="mr-4 mb-4 text-center">
        {movie.tmdbUrl ? (
          <a href={movie.tmdbUrl} target="_blank" rel="noopener noreferrer" className="group">
            <img
              src={movie.poster ?? undefined}
              alt={movie.title}
              loading="lazy"
              className="w-32 h-auto rounded-lg border-2 border-transparent group-hover:border-purple-400 group-hover:shadow-lg transition-all duration-300"
            />
          </a>
        ) : (
          <div className="w-32 h-48 bg-gray-700 flex items-center justify-center rounded-lg">
            <span className="text-gray-400 text-xs">No Image</span>
          </div>
        )}
        <p className="text-xs mt-1 text-gray-300 font-semibold">{movie.title}</p>
        <p className="text-xs text-gray-400">{movie.releaseYear} | {movie.genre}</p>
      </div>
    ))}
  </div>
)}
      </div>
    </motion.div>
  ))}
</AnimatePresence>
              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSubmit} className="flex gap-2 mt-4">
              <Input
                type="text"
                value={inputText}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  console.log("Input changed:", e.target.value)
                  setInputText(e.target.value)
                }}
                placeholder="Enter movies you like..."
                disabled={isLoading}
                className="flex-grow bg-gray-700 border-gray-600 text-white placeholder-gray-400"
              />
              <Button type="submit" disabled={isLoading} className="bg-purple-600 hover:bg-purple-700 text-white">
                {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
              </Button>
            </form>
          </CardContent>
        </Card>

      </div>
      <footer style={{ textAlign: 'center', paddingTop: '20px' }}>
       
      

      <p 
  className="text font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600 mb-4"
  style={{
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    color: "white" // Fallback for unsupported browsers
  }}
>
  Presented by Thomas DeVito
</p>

  <div style={{ display: 'flex', justifyContent: 'center', marginTop: '2px' }}>
    <a href="https://x.com/thomasfdevito" target="_blank" rel="noopener noreferrer">
      <FontAwesomeIcon icon={faTwitter} style={{ margin: '0 10px', fontSize: '24px', color: 'white' }} />
    </a>
    <a href="https://telegram.com" target="_blank" rel="noopener noreferrer">
      <FontAwesomeIcon icon={faTelegram} style={{ margin: '0 10px', fontSize: '24px', color: 'white' }} />
    </a>
    <a href="https://www.linkedin.com/in/tdevito" target="_blank" rel="noopener noreferrer">
      <FontAwesomeIcon icon={faLinkedin} style={{ margin: '0 10px', fontSize: '24px', color: 'white' }} />
    </a>
    <a href="https://github.com/tommyd2377" target="_blank" rel="noopener noreferrer">
      <FontAwesomeIcon icon={faGithub} style={{ margin: '0 10px', fontSize: '24px', color: 'white' }} />
    </a>
  </div>
  <div className="mt-8 text-center text-gray-400 text-sm">
        <p>Powered by TMDB and OpenAI</p>
        </div>
  <div style={{
  fontFamily: 'Arial, sans-serif',
  fontSize: '16px',
  textAlign: 'center',
  color: '#333'
}}>
  Made with <span style={{ color: '#e25555', fontSize: '24px' }}>&hearts;</span> in NYC
</div>
</footer>
    </div>

    
  )
 
}