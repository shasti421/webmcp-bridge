/**
 * Todo App client-side JavaScript.
 * Fetches todos from /api/todos and renders them into the DOM.
 * Matches the selector structure defined in semantic-examples/demo-todo-app/pages/todo_list.yaml.
 */
(function () {
  'use strict';

  var todoList = document.querySelector('.todo-list');
  var newTodoInput = document.querySelector('.new-todo');
  var addButton = document.querySelector('.add-todo');
  var todoCountEl = document.querySelector('.todo-count');

  function renderTodos(todos) {
    todoList.innerHTML = '';
    var remaining = 0;

    todos.forEach(function (todo) {
      if (!todo.completed) remaining++;

      var li = document.createElement('li');
      li.className = 'todo-item' + (todo.completed ? ' completed' : '');
      li.setAttribute('role', 'listitem');
      li.dataset.id = todo.id;

      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'todo-toggle';
      checkbox.checked = todo.completed;
      checkbox.addEventListener('change', function () {
        toggleTodo(todo.id, !todo.completed);
      });

      var span = document.createElement('span');
      span.className = 'todo-text';
      span.textContent = todo.title;

      var deleteBtn = document.createElement('button');
      deleteBtn.className = 'todo-delete';
      deleteBtn.textContent = 'Delete';
      deleteBtn.setAttribute('aria-label', 'Delete ' + todo.title);
      deleteBtn.addEventListener('click', function () {
        deleteTodo(todo.id);
      });

      li.appendChild(checkbox);
      li.appendChild(span);
      li.appendChild(deleteBtn);
      todoList.appendChild(li);
    });

    todoCountEl.textContent = remaining + ' item' + (remaining !== 1 ? 's' : '') + ' left';
  }

  function fetchTodos() {
    fetch('/api/todos')
      .then(function (res) { return res.json(); })
      .then(renderTodos);
  }

  function addTodo(title) {
    fetch('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title }),
    })
      .then(function () { return fetchTodos(); });
  }

  function toggleTodo(id, completed) {
    fetch('/api/todos/' + id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed: completed }),
    })
      .then(function () { return fetchTodos(); });
  }

  function deleteTodo(id) {
    fetch('/api/todos/' + id, {
      method: 'DELETE',
    })
      .then(function () { return fetchTodos(); });
  }

  addButton.addEventListener('click', function () {
    var text = newTodoInput.value.trim();
    if (text) {
      addTodo(text);
      newTodoInput.value = '';
    }
  });

  newTodoInput.addEventListener('keypress', function (e) {
    if (e.key === 'Enter') {
      var text = newTodoInput.value.trim();
      if (text) {
        addTodo(text);
        newTodoInput.value = '';
      }
    }
  });

  // Initial load
  fetchTodos();
})();
