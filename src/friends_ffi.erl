-module(friends_ffi).
-export([unix_seconds/0]).

unix_seconds() -> erlang:system_time(second).
