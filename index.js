// load .env
import dotenv from 'dotenv'
if (process.env.NODE_ENV !== 'production') {
  dotenv.config()
}

import http from 'http'
import { URL, URLSearchParams } from 'url'
import express from 'express'
import bodyParser from 'body-parser'
import { ETwitterStreamEvent, TweetStream, TwitterApi, ETwitterApiError } from 'twitter-api-v2'
import _ from 'lodash'

let steamClient, tweetClient, clientUserName

if (process.env.TWITTER_ACCESS_TOKEN) {
  tweetClient = new TwitterApi({
    appKey: process.env.TWITTER_CONSUMER_KEY,
    appSecret: process.env.TWITTER_CONSUMER_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_SECRET,
  })
  const verifiedUser = await tweetClient.currentUser()
  clientUserName = verifiedUser.screen_name
  console.log('🌳 connected to twitter user', clientUserName)
  console.log('🕊 tweetClient started, waiting for streamClient…')
} else {
  console.log('🚑 missing auth for tweetClient, use /sign-in')
}

const app = express()
app.use(bodyParser.json({ limit: '650kb' }))
const server = http.createServer(app)
app.listen(process.env.PORT)
console.log('🔮 server is listening to http')

// http
app.get('/', (request, response) => {
  console.log('🐢 /')
  response.json({
    message: 'kinopio-twitter-replies is online',
    repo: 'https://github.com/kinopio-club/kinopio-twitter-replies'
  })
})

// AUTH STEP 1: sign in to allow tweeting
// You should only need to do this once per environment
// http://localhost:8060/sign-in
// https://twitter-replies.kinopio.club/sign-in
app.get('/sign-in', async (request, response) => {
  console.log('🐢 /sign-in')
  tweetClient = new TwitterApi({
    appKey: process.env.TWITTER_CONSUMER_KEY,
    appSecret: process.env.TWITTER_CONSUMER_SECRET
  })
  const authLink = await tweetClient.generateAuthLink()
  response.json({
    message: 'store tokens, the auth url will return a PIN. Then pass them to /sign-in-complete',
    auth_url: authLink.url,
    oauth_token: authLink.oauth_token,
    oauth_token_secret: authLink.oauth_token_secret,
  })
})
// AUTH STEP 2: complete sign in
// http://localhost:8060/sign-in-complete?pin=123&oauth_token=ABC&oauth_token_secret=XYZ
// https://twitter-replies.kinopio.club/sign-in-complete?pin=123&oauth_token=ABC&oauth_token_secret=XYZ
app.get('/sign-in-complete', async (request, response) => {
  console.log('🐢 /sign-in-complete')
  const { pin, oauth_token, oauth_token_secret } = request.query
  console.log('🌿', pin, oauth_token, oauth_token_secret)
  const tweetClient = new TwitterApi({
    appKey: process.env.TWITTER_CONSUMER_KEY,
    appSecret: process.env.TWITTER_CONSUMER_SECRET,
    accessToken: oauth_token,
    accessSecret: oauth_token_secret,
  })
  const { client: loggedClient, accessToken, accessSecret } = await tweetClient.login(pin)
  // AUTH STEP 3: copy keys from loggedClient to env
  console.log('💖',loggedClient)
  response.json({
    message: 'update env with TWITTER_ACCESS_TOKEN and TWITTER_ACCESS_SECRET from 💖 log',
    oauth_token,
    oauth_token_secret,
    loggedClient
  })
})

// init streaming

const clearRules = async () => {
  let rules = await steamClient.v2.streamRules()
  if (rules.data) {
    const rulesIds = rules.data.map(rule => rule.id)
    await steamClient.v2.updateStreamRules({
      delete: {
        ids: rulesIds,
      },
    })
  }
  rules = await steamClient.v2.streamRules()
  console.log('🌚 rules cleared')
}

const addRules = async () => {
  const rules = await steamClient.v2.updateStreamRules({
    add: [
      { value: '@kinopioclub save -from:kinopioclub', tag: 'reply with save' },
    ]
  })
  console.log('🌝 rules added', rules)
}

// utils

const tweetUrl = ({ tweetId, username }) => {
  username = username || clientUserName
  return `https://twitter.com/${username}/status/${tweetId}`
}

const replyMessage = (tweet) => {
  const spaceUrl = `https://kinopio.club/twitter-thread/${tweet.id}`
  const kaomojis = ['ヾ(＾∇＾)', '(^-^*)/', '( ﾟ▽ﾟ)/', '( ^_^)／', '(^o^)/', '(^ _ ^)/', '( ´ ▽ ` )ﾉ', '(ﾉ´∀｀*)ﾉ', 'ヾ(´･ω･｀)', '☆ﾐ(o*･ω･)ﾉ', '＼(＾▽＾*)', '(*＾▽＾)／', '(￣▽￣)ノ', 'ヾ(-_-;)', 'ヾ( ‘ – ‘*)', 'ヾ(＠⌒ー⌒＠)ノ', '~ヾ ＾∇＾', '~ヾ(＾∇＾)', '＼(￣O￣)', '(｡･ω･)ﾉﾞ', '(*^･ｪ･)ﾉ', '(￣∠ ￣ )ﾉ', '(*￣Ｏ￣)ノ', 'ヾ(｡´･_●･`｡)☆', '(/・0・)', '(ノ^∇^)', '(,, ･∀･)ﾉ゛', '(。･д･)ﾉﾞ', '＼(°o°；）', '(｡´∀｀)ﾉ', '(o´ω`o)ﾉ', '( ･ω･)ﾉ', '(。^_・)ノ', '( ・_・)ノ', '＼(-o- )', '(。-ω-)ﾉ', '＼(-_- )', '＼( ･_･)', 'ヾ(´￢｀)ﾉ', 'ヾ(☆▽☆)', '(^ Q ^)/゛', '~(＾◇^)/', 'ヘ(‘◇’、)/', 'ヘ(°◇、°)ノ', 'ヘ(°￢°)ノ', 'ヘ(゜Д、゜)ノ', '（ ゜ρ゜)ノ', 'ー( ´ ▽ ` )ﾉ', 'ヽ(๏∀๏ )ﾉ']
  const kaomoji = _.sample(kaomojis)
  return `${kaomoji}\n\nHere's a space to explore this twitter thread,\n\n${spaceUrl}\n\n(p.s. anyone can use this to make their own space – no sign up required)`
}

// respond to streaming tweets

const tweetReply = async (data) => {
  const tweet = data.data
  console.log('💁‍♀️', data)
  let excludedUsers = []
  data.includes.users.forEach((user, index) => {
    console.log('🐶',user, index)
    if (index > 0) {
      excludedUsers.push(user.id)
    }
  })
  excludedUsers = excludedUsers.join(',')
  console.log('🍋🍋',excludedUsers)
  const message = replyMessage(tweet)
  // const options = {
  //   in_reply_to_status_id: tweet.id_str,
  //   auto_populate_reply_metadata: true,
  //   exclude_reply_user_ids: excludedUsers
  // }
  if (process.env.NODE_ENV === 'production') {
    const reply = await tweetClient.v1.reply(message, tweet.id_str, { exclude_reply_user_ids: excludedUsers })
    console.log('💌 replied', reply, options, tweetUrl({ tweetId: reply.id_str }))
  } else {
    console.log('✉️ preflight reply', message, tweet.id_str)
  }
}

const handleTweet = async (data) => {
  console.log('☮️☮️',data)
  const rule = data.matching_rules[0].tag
  if (rule === 'reply with save') {
    tweetReply(data)
  } else {
    const username = data.includes.users[0].username
    const tweet = data.data
    // TODO post to discord
    // defer to next version, pending noise becoming an issue
    console.log('💐 TODO post to discord', username, tweet, tweetUrl({ tweetId: tweet.id_str, username }))
  }
}

const listen = async () => {
  steamClient = new TwitterApi(process.env.TWITTER_API_BEARER_TOKEN)
  console.log('🌸 server is listening to stream')
  await clearRules()
  await addRules()
  try {
    const stream = await steamClient.v2.searchStream({ expansions: ['author_id'], 'user.fields': ['username'] })
    stream.on(
      ETwitterStreamEvent.Data,
      eventData => {
        handleTweet(eventData)
      },
    )
    stream.autoReconnect = true
  } catch (error) {
    console.error('🚒', error)
  }
}

console.log('waiting to listen to stream…')
setTimeout(() => {
  console.log('🌷 starting listen to stream')
  listen()
}, 1 * 60 * 1000) // wait 1 minute to start streaming
