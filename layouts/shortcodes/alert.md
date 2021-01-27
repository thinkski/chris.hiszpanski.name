<div class="bg-{{ .Get "color" }}-100 border-l-4 border-{{ .Get "color" }}-500 text-{{ .Get "color" }}-700 px-4 py-1 my-6 rounded" role="alert">
  <p class="font-bold">{{ .Get "title" }}</p>
  <p>{{ .Inner }}</p>
</div>
