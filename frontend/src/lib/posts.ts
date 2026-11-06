// Travel posts. Loaded on demand, separately from the app's main state, so trips stay as fast as they were.
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "./api";

export type PostVisibility = "public" | "friends" | "only_me";

export interface TravelPost {
  id: string;
  author: { id: string; name: string; avatar: string; username: string | null };
  caption: string;
  destination: string;
  trip: { id: string; name: string; isMember: boolean } | null;
  /** Only shown to the author. */
  visibility?: PostVisibility;
  photos: string[];
  createdAt: string;
  edited: boolean;
  likeCount: number;
  commentCount: number;
  likedByMe: boolean;
  mine: boolean;
}

export interface PostComment {
  id: string;
  text: string;
  at: string;
  author: { id: string; name: string; avatar: string; username: string | null };
  canDelete: boolean;
}

export const VISIBILITY_LABEL: Record<PostVisibility, string> = { public: "Public", friends: "Friends", only_me: "Only me" };
export const VISIBILITY_HINT: Record<PostVisibility, string> = {
  public: "Anyone signed in to TripOS can see it.",
  friends: "Only your friends can see it.",
  only_me: "Only you can see it.",
};

const KEY = "social";
type Page = { posts: TravelPost[]; hasMore: boolean };
const pageParams = (last: Page) => {
  const oldest = last.posts[last.posts.length - 1];
  return last.hasMore && oldest ? `before=${encodeURIComponent(oldest.createdAt)}&beforeId=${encodeURIComponent(oldest.id)}` : undefined;
};

export const useFeed = () => useInfiniteQuery({
  queryKey: [KEY, "posts", "feed"],
  initialPageParam: "",
  queryFn: ({ pageParam }) => apiGet<Page>(`/feed?${pageParam}`),
  getNextPageParam: pageParams,
});

export const useProfilePosts = (username: string, enabled: boolean) => useInfiniteQuery({
  queryKey: [KEY, "posts", "profile", username.toLowerCase()],
  initialPageParam: "",
  queryFn: ({ pageParam }) => apiGet<Page>(`/profiles/${encodeURIComponent(username)}/posts?${pageParam}`),
  getNextPageParam: pageParams,
  enabled,
});

export const usePost = (id: string, enabled = true) => useQuery({ queryKey: [KEY, "posts", "one", id], queryFn: () => apiGet<TravelPost>(`/posts/${id}`), retry: false, enabled });
export const useComments = (id: string, enabled: boolean) => useQuery({ queryKey: [KEY, "posts", "comments", id], queryFn: () => apiGet<PostComment[]>(`/posts/${id}/comments`), enabled });

export interface NewPost {
  id: string;
  caption: string;
  destination: string;
  tripId: string | null;
  visibility: PostVisibility;
  photos: string[];
  fromPhotoId?: string;
}

export function usePostActions() {
  const client = useQueryClient();
  const refreshing = <T,>(work: Promise<T>) => work.then(async (result) => {
    await client.invalidateQueries({ queryKey: [KEY, "posts"] });
    return result;
  });
  return {
    create: (post: NewPost) => refreshing(apiPost<TravelPost>("/posts", post)),
    update: (id: string, patch: { caption?: string; destination?: string; visibility?: PostVisibility }) => refreshing(apiPatch<TravelPost>(`/posts/${id}`, patch)),
    remove: (id: string) => refreshing(apiDelete(`/posts/${id}`)),
    like: (id: string, liked: boolean) => refreshing(liked ? apiPut(`/posts/${id}/like`) : apiDelete(`/posts/${id}/like`)),
    comment: (id: string, text: string) => refreshing(apiPost(`/posts/${id}/comments`, { text })),
    deleteComment: (id: string, commentId: string) => refreshing(apiDelete(`/posts/${id}/comments/${commentId}`)),
    report: (id: string, reason: string, details: string) => apiPost("/reports", { targetType: "post", targetId: id, reason, details }),
  };
}
