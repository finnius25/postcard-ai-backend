import { genLLM } from "../clients/llmClient.js";
import { supabase } from "../clients/supabase.js";

// Helper function to duplicate blogs to reach target count
const duplicateBlogsToTargetCount = (blogs, targetCount) => {
  const duplicatedBlogs = [...blogs];

  // If we already have more blogs than the target count, cut the array
  if (duplicatedBlogs.length > targetCount) {
    return duplicatedBlogs.slice(0, targetCount);
  }

  while (duplicatedBlogs.length < targetCount) {
    // Get the next blog to duplicate (cycling through the original list)
    const originalBlog = blogs[duplicatedBlogs.length % blogs.length];

    // Create a duplicate with a new id to avoid conflicts
    const duplicatedBlog = {
      ...originalBlog,
      id: `dup-${duplicatedBlogs.length}`, // Create a unique ID
    };

    duplicatedBlogs.push(duplicatedBlog);
  }

  return duplicatedBlogs;
};

export const useLLMRanking = async (
  preferences,
  model = "google/gemini-2.0-flash-001",
  targetCount = 5
) => {
  try {
    const startTime = new Date();

    // Fetch all blogs from Supabase
    const { data: blogs, error } = await supabase.from("blogs").select("*");

    if (error) {
      throw error;
    }

    console.log(`Original blog count: ${blogs.length}`);

    // Duplicate blogs to reach 1000 entries
    const expandedBlogs = duplicateBlogsToTargetCount(blogs, targetCount);
    console.log(`Expanded blog count for testing: ${expandedBlogs.length}`);

    // Prepare the blogs data for ranking
    const blogsData = expandedBlogs.map((blog) => ({
      id: blog.id,
      title: blog.title,
      content_metadata: blog.content_metadata,
    }));

    // Create the prompt for ranking
    const prompt = `
    You are a helpful assistant that ranks blog posts based on user preferences.
    Given the following user preferences and a list of blog posts, rank the blog posts from most relevant to least relevant.
    Consider the title and content_metadata when ranking.
    
    User Preferences:
    ${JSON.stringify(preferences, null, 2)}
    
    Blog Posts to Rank:
    ${JSON.stringify(blogsData, null, 2)}
    
    Please return a JSON array of blog ids in order of relevance, from most to least relevant. Do not include any other text or formatting.
    Example:
    {
      "ranked_ids": ["1", "2", "3", "4", "5"]
    }
    `;

    console.log("prompt", prompt);

    // Get ranking from LLM
    const response = await genLLM.chat.completions.create({
      model: model,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "ranking",
          schema: {
            type: "object",
            properties: {
              ranked_ids: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: ["ranked_ids"],
          },
        },
      },
    });

    console.log("response", response);

    // Parse the JSON response
    const responseContent = response.choices[0].message.content.trim();

    console.log("responseContent", responseContent);

    const parsedResponse = JSON.parse(responseContent);

    // Get the ranked IDs from the parsed response
    const rankedBlogs = parsedResponse.ranked_ids;

    if (!rankedBlogs || !Array.isArray(rankedBlogs)) {
      throw new Error("No valid ranked_ids array found in the LLM response");
    }

    // Map the ranked titles back to full blog data
    const rankedBlogsWithData = rankedBlogs
      .map((id) => {
        // Find in the expanded blogs list
        const blog = expandedBlogs.find((b) => String(b.id) === String(id));

        if (!blog) {
          console.warn(`Blog with id ${id} not found in expanded list`);
          return null;
        }

        return {
          id: blog.id,
          title: blog.title,
          summary: blog.summary,
          url: blog.url,
          content_metadata: blog.content_metadata,
          categories:
            blog.categories && blog.categories.length > 0
              ? blog.categories.map((c) => c.name)
              : [],
          tags:
            blog.tags && blog.tags.length > 0
              ? blog.tags.map((t) => t.name)
              : [],
        };
      })
      .filter(Boolean); // Filter out any null values

    const endTime = new Date();
    const duration = endTime - startTime;

    return {
      metric: {
        duration,
        usage: response.usage,
        total: expandedBlogs.length,
      },
      preferences,
      recommendations: rankedBlogsWithData,
    };
  } catch (error) {
    console.error("Error getting blog recommendations:", error);
    throw error;
  }
};
